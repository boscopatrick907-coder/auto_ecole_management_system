import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SignJWT, importPKCS8, exportJWK, importSPKI } from "jose";
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import type pg from "pg";
import { poolFor, tenantTransaction, type TenantBindings } from "./context.js";
import { createAuth } from "./auth.js";

const app = new Hono<{ Bindings: TenantBindings }>();
const uuid = z.string().uuid();
const money = z.number().int().positive().max(1_000_000_000);
const phone = z.string().regex(/^\+237[26][0-9]{8}$/);
const offlineReceiptRegex = /^RC-(?![0-9]{4}-)[A-Z0-9]{4,32}-[0-9]{1,12}$/;

const fail = (code: string, status = 400) =>
  Object.assign(new Error(code), { status });

function enrichPaymentSql(alias = "p") {
  return `
    ${alias}.*,
    school_app.actor_display_name(${alias}.recorded_by) as recorded_by_name,
    b.total_fee::bigint as enrollment_total_fee,
    b.balance::bigint as current_balance,
    case
      when ${alias}.cancelled_at is not null then null
      else (
        b.total_fee - coalesce((
          select sum(p2.amount)
          from school_app.payments p2
          where p2.school_id = ${alias}.school_id
            and p2.enrollment_id = ${alias}.enrollment_id
            and p2.cancelled_at is null
            and (p2.paid_at < ${alias}.paid_at or (p2.paid_at = ${alias}.paid_at and p2.id <= ${alias}.id))
        ), 0)
      )::bigint
    end as balance_at_issuance,
    case when ${alias}.cancelled_at is not null then 'cancelled' else 'confirmed' end as receipt_status,
    (${alias}.receipt_number ~ '^RC-[A-Z0-9]{4,32}-[0-9]{1,12}$' and ${alias}.receipt_number !~ '^RC-[0-9]{4}-[0-9]+$') as is_offline_provisional_number
  `;
}

app.use("*", bodyLimit({ maxSize: 1024 * 1024 }));
app.use("*", async (c, next) =>
  cors({
    origin: (origin) =>
      (c.env.TRUSTED_ORIGINS || "").split(",").map((x) => x.trim()).includes(origin)
        ? origin
        : "",
    credentials: true,
  })(c, next),
);
app.use("*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    const trusted = (c.env.TRUSTED_ORIGINS || "").split(",").map((x) => x.trim());
    if (!origin || !trusted.includes(origin))
      return c.json({ error: "ORIGIN_FORBIDDEN" }, 403);
  }
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/config", (c) =>
  c.json({
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || "",
    contractVersion: "2026-11-10.v1",
    authModes: {
      emailPassword: true,
      walkInInviteClaim: true,
      selfEnroll: true,
      phoneOtp: false,
      passwordRecoveryEmail: Boolean(
        c.env.AUTH_EMAIL_WEBHOOK && c.env.AUTH_EMAIL_TOKEN,
      ),
    },
  }),
);

app.all("/api/auth/*", async (c) => {
  const pool = poolFor(c.env, true);
  try {
    if (c.req.path.endsWith("/sign-up/email")) {
      const ip = c.req.header("CF-Connecting-IP") || "unknown";
      if (
        !c.env.SIGNUP_LIMITER ||
        !(await c.env.SIGNUP_LIMITER.limit({ key: ip })).success
      )
        return c.json({ error: "RATE_LIMITED" }, 429);
      const token = c.req.header("X-Turnstile-Token");
      if (!token || !c.env.TURNSTILE_SECRET_KEY)
        return c.json({ error: "TURNSTILE_REQUIRED" }, 403);

      const tokenHash = createHash("sha256").update(token).digest("hex");
      const replayKey = "turnstile-replay:" + tokenHash;
      await pool.query(
        'DELETE FROM identity.verification WHERE identifier LIKE \'turnstile-replay:%\' AND "expiresAt" < now()',
      );
      const existingReplay = await pool.query(
        "SELECT 1 FROM identity.verification WHERE identifier = $1",
        [replayKey],
      );
      if (existingReplay.rowCount) {
        return c.json({ error: "TURNSTILE_FAILED" }, 403);
      }

      const response = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body: new URLSearchParams({
            secret: c.env.TURNSTILE_SECRET_KEY,
            response: token,
            remoteip: ip,
          }),
        },
      );
      const result = (await response.json()) as { success: boolean };
      if (!result.success) return c.json({ error: "TURNSTILE_FAILED" }, 403);

      await pool.query(
        'INSERT INTO identity.verification(id, identifier, value, "expiresAt") VALUES ($1, $2, \'used\', now() + interval \'15 minutes\')',
        [randomUUID(), replayKey],
      );
    }
    return await createAuth(c.env, pool).handler(c.req.raw);
  } catch (e) {
    if (e instanceof Error && e.message === "EMAIL_DELIVERY_UNAVAILABLE") {
      return c.json({ error: "EMAIL_DELIVERY_UNAVAILABLE" }, 503);
    }
    throw e;
  } finally {
    await pool.end();
  }
});

async function dossier(db: pg.PoolClient, id?: string) {
  const s = await db.query(
    `select s.*,school_app.student_has_paid(s.id) as has_paid,school_app.student_has_access(s.id) as has_access from school_app.students s where ${id ? "id=$1" : "user_id=$1"} limit 1`,
    [
      id ||
        (await db
          .query("select school_app.user_id() as id")
          .then((x) => x.rows[0].id)),
    ],
  );
  if (!s.rowCount) throw fail("STUDENT_NOT_FOUND", 404);
  const e = await db.query(
    `select b.enrollment_id as id,b.*,e.status,e.created_at from school_app.enrollment_balances b join school_app.enrollments e on e.school_id=b.school_id and e.id=b.enrollment_id where b.student_id=$1 order by (e.status <> 'cancelled') desc, e.created_at desc, e.id desc limit 1`,
    [s.rows[0].id],
  );
  const enrollment = e.rows[0] || null;
  const installments = enrollment
    ? (
        await db.query(
          "select * from school_app.installment_status where enrollment_id=$1 order by position",
          [enrollment.id],
        )
      ).rows
    : [];
  const payments = enrollment
    ? (
        await db.query(
          `select ${enrichPaymentSql("p")} from school_app.payments p join school_app.enrollment_balances b on b.school_id=p.school_id and b.enrollment_id=p.enrollment_id where p.enrollment_id=$1 order by p.paid_at desc, p.id desc`,
          [enrollment.id],
        )
      ).rows
    : [];
  const attempts = (
    await db.query(
      "select id,quiz_id,score,total,taken_at from school_app.quiz_attempts where student_id=$1 order by taken_at desc limit 50",
      [s.rows[0].id],
    )
  ).rows;
  return { student: s.rows[0], enrollment, installments, payments, attempts };
}

app.post("/api/platform/schools", async (c) => {
  const pool = poolFor(c.env),
    identity = poolFor(c.env, true);
  try {
    const session = await createAuth(c.env, identity).api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) throw fail("AUTH_REQUIRED", 401);
    const b = z
      .object({
        action: z.enum(["create_school", "suspend_school", "activate_school"]),
        schoolId: uuid.nullable().optional(),
        reason: z.string().trim().min(5).max(500),
        data: z
          .object({
            name: z.string().min(2).max(150).optional(),
            slug: z
              .string()
              .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
              .optional(),
            address: z.string().max(300).optional(),
            phone: z.string().max(30).optional(),
            whatsapp: z.string().max(30).optional(),
            agrement_number: z.string().max(100).optional(),
            adminUserId: z.string().max(200).optional(),
          })
          .default({}),
      })
      .parse(await c.req.json());
    return await tenantTransaction(pool, "", session.user.id, async (db) =>
      c.json({
        school: (
          await db.query(
            "select school_app.platform_action($1,$2,$3,$4) as school",
            [b.action, b.schoolId || null, b.reason, JSON.stringify(b.data)],
          )
        ).rows[0].school,
      }),
    );
  } finally {
    await Promise.all([pool.end(), identity.end()]);
  }
});

app.all("/api/schools/:slug/*", async (c) => {
  const pool = poolFor(c.env);
  const authPool = poolFor(c.env, true);
  try {
    const hasSessionCookie = Boolean(c.req.header("cookie"));
    const session = hasSessionCookie
      ? await createAuth(c.env, authPool).api.getSession({
          headers: c.req.raw.headers,
        })
      : null;
    const userId = session?.user.id || null;
    if (
      c.req.header("X-Expected-User") &&
      c.req.header("X-Expected-User") !== userId
    )
      throw fail("SESSION_IDENTITY_CHANGED", 403);
    return await tenantTransaction(pool, "", userId, async (db) => {
      const resolved = await db.query(
        "select * from school_app.resolve_school($1)",
        [c.req.param("slug")],
      );
      if (!resolved.rowCount) throw fail("SCHOOL_NOT_FOUND", 404);
      const schoolId = resolved.rows[0].id;
      await db.query("select set_config('app.school_id',$1,true)", [schoolId]);
      const path = c.req.path.split("/").slice(4).join("/");
      const method = c.req.method;
      const school = (await db.query("select * from school_app.schools"))
        .rows[0];
      if (!school) throw fail("SCHOOL_NOT_FOUND", 404);

      if (path === "catalogue" && method === "GET") {
        const categories = (
          await db.query(
            "select * from school_app.licence_categories where is_active order by code",
          )
        ).rows;
        const groups = (
          await db.query(
            `select g.*,lc.name as licence_name,(select count(distinct e.id)::int from school_app.enrollments e join school_app.payments p on p.school_id=e.school_id and p.enrollment_id=e.id and p.cancelled_at is null where e.school_id=g.school_id and e.group_id=g.id and e.status<>'cancelled') as confirmed_seats from school_app.groups g join school_app.licence_categories lc on lc.school_id=g.school_id and lc.id=g.licence_category_id where g.status='open' order by g.start_date, g.id`,
          )
        ).rows;
        const allInstallments = (
          await db.query(
            "select * from school_app.installments order by group_id, position",
          )
        ).rows;
        return c.json({
          school,
          categories,
          groups: groups.map((g) => ({
            ...g,
            installments: allInstallments.filter((i) => i.group_id === g.id),
          })),
        });
      }

      if (!session) throw fail("AUTH_REQUIRED", 401);
      const role = (await db.query("select school_app.member_role() as role"))
        .rows[0].role;
      if (path === "enroll" && method === "POST") {
        const b = z
          .object({
            groupId: uuid,
            fullName: z.string().trim().min(2).max(150),
            phone,
          })
          .parse(await c.req.json());
        await db.query("select school_app.enroll_self($1,$2,$3)", [
          b.groupId,
          b.fullName,
          b.phone,
        ]);
        return c.json({ ok: true }, 201);
      }
      if (path === "claim-invite" && method === "POST") {
        const b = z
          .object({ inviteCode: z.string().min(10).max(100), phone })
          .parse(await c.req.json());
        await db.query("select school_app.claim_invite($1,$2)", [
          b.inviteCode,
          b.phone,
        ]);
        return c.json({ ok: true }, 201);
      }
      if (!role) throw fail("MEMBERSHIP_REQUIRED", 403);
      if (path === "session")
        return c.json({ user: session.user, role, school });
      if (path === "lease") {
        const d = role === "student" ? await dossier(db) : null;
        const now = Date.now();
        const max = now + 72 * 3600000;
        const key = await importPKCS8(c.env.OFFLINE_PRIVATE_KEY_PEM, "EdDSA");
        const pem = createPublicKey(c.env.OFFLINE_PRIVATE_KEY_PEM)
          .export({ type: "spki", format: "pem" })
          .toString();
        const pub = await exportJWK(await importSPKI(pem, "EdDSA"));
        const token = await new SignJWT({
          schoolId,
          role,
          hasAccess: d?.student.has_access ?? true,
          hasPaid: d?.student.has_paid ?? false,
          trialEndsAt: d?.student.trial_ends_at ?? null,
          maxOfflineUntilMs: max,
          serverTimeMs: now,
        })
          .setProtectedHeader({ alg: "EdDSA" })
          .setSubject(userId!)
          .setIssuer("school-api")
          .setAudience("school-pwa")
          .setIssuedAt()
          .setExpirationTime(Math.floor(max / 1000))
          .sign(key);
        return c.json({ token, publicKey: pub });
      }
      if (path === "me" && method === "GET") return c.json(await dossier(db));
      if (path === "resources" && method === "GET") {
        const rows = (
          await db.query(
            "select id,licence_category_id,title,description,type,is_published from school_app.resources where is_published order by title,id",
          )
        ).rows;
        return c.json({ resources: rows });
      }
      const file = /^resources\/([0-9a-f-]+)\/url$/.exec(path);
      if (file && method === "GET") {
        const r = (
          await db.query(
            "select storage_path,external_url from school_app.resources where id=$1 and is_published",
            [uuid.parse(file[1])],
          )
        ).rows[0];
        if (!r) throw fail("RESOURCE_FORBIDDEN", 403);
        if (!r.storage_path && r.external_url) {
          if (!String(r.external_url).startsWith("https://"))
            throw fail("RESOURCE_FORBIDDEN", 403);
          return c.json({ url: r.external_url, expiresIn: null });
        }
        if (
          !c.env.R2_ACCOUNT_ID ||
          !c.env.R2_ACCESS_KEY_ID ||
          !c.env.R2_SECRET_ACCESS_KEY
        )
          throw fail("STORAGE_UNCONFIGURED", 503);
        const s3 = new S3Client({
          region: "auto",
          endpoint: `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: c.env.R2_ACCESS_KEY_ID,
            secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
          },
        });
        return c.json({
          url: await getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: c.env.R2_BUCKET_NAME,
              Key: r.storage_path,
            }),
            { expiresIn: 120 },
          ),
          expiresIn: 120,
        });
      }
      if (path === "quizzes" && method === "GET") {
        const quizzes = (
          await db.query(
            "select id,licence_category_id,title,duration_minutes,is_published from school_app.quizzes where is_published order by title,id",
          )
        ).rows;
        const questions = (
          await db.query(
            "select id,quiz_id,body,options,image_url,explanation,position from school_app.questions order by position,id",
          )
        ).rows;
        return c.json({
          quizzes: quizzes.map((q) => ({
            ...q,
            questions: questions.filter((x) => x.quiz_id === q.id),
          })),
        });
      }
      if (path === "quiz-attempts" && method === "POST") {
        const b = z
          .object({
            quizId: uuid,
            clientId: uuid,
            answers: z.record(uuid, z.string().regex(/^\d+$/)),
            takenAt: z.string().datetime(),
          })
          .parse(await c.req.json());
        const r = await db.query(
          "select * from school_app.submit_quiz($1,$2,$3,$4)",
          [b.quizId, JSON.stringify(b.answers), b.clientId, b.takenAt],
        );
        const expRows = (
          await db.query(
            "select id, explanation from school_app.questions where quiz_id=$1 order by position,id",
            [b.quizId],
          )
        ).rows;
        return c.json(
          {
            attempt: r.rows[0],
            explanations: Object.fromEntries(
              expRows.map((row) => [row.id, row.explanation || ""]),
            ),
          },
          201,
        );
      }

      if (role !== "admin") throw fail("ADMIN_REQUIRED", 403);

      if (path === "admin/dashboard") {
        const k = (
          await db.query(
            `select (select count(*) from school_app.students) as students,(select coalesce(sum(amount),0) from school_app.payments where cancelled_at is null) as collected,(select coalesce(sum(balance),0) from school_app.enrollment_balances) as owed,(select count(distinct enrollment_id) from school_app.installment_status where status='overdue') as overdue`,
          )
        ).rows[0];
        return c.json({
          ...k,
          recentPayments: (
            await db.query(
              `select ${enrichPaymentSql("p")},s.full_name as student_name,s.phone from school_app.payments p join school_app.enrollments e on e.school_id=p.school_id and e.id=p.enrollment_id join school_app.enrollment_balances b on b.school_id=p.school_id and b.enrollment_id=p.enrollment_id join school_app.students s on s.school_id=e.school_id and s.id=e.student_id order by p.paid_at desc, p.id desc limit 10`,
            )
          ).rows,
        });
      }

      if (path === "admin/students" && method === "GET") {
        const searchPattern =
          "%" + (c.req.query("search") || "").trim().slice(0, 100) + "%";
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .parse(c.req.query("limit") || 50);
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(500000)
          .parse(c.req.query("offset") || 0);

        const totalRes = await db.query(
          "select count(*)::int as count from school_app.students s where s.full_name ilike $1 or s.phone ilike $1",
          [searchPattern],
        );
        const totalCount = totalRes.rows[0].count;

        const students = (
          await db.query(
            `select
               s.*,
               school_app.student_has_paid(s.id) as has_paid,
               school_app.student_has_access(s.id) as has_access,
               b.enrollment_id,
               b.group_id,
               b.group_name,
               b.balance,
               b.paid,
               b.total_fee,
               b.enrollment_status
             from school_app.students s
             left join lateral (
               select
                 b.enrollment_id,
                 b.group_id,
                 b.group_name,
                 b.balance,
                 b.paid,
                 b.total_fee,
                 e.status as enrollment_status,
                 e.created_at as enrollment_created_at
               from school_app.enrollment_balances b
               join school_app.enrollments e on e.school_id = b.school_id and e.id = b.enrollment_id
               where b.student_id = s.id
               order by (e.status <> 'cancelled') desc, e.created_at desc, e.id desc
               limit 1
             ) b on true
             where s.full_name ilike $1 or s.phone ilike $1
             order by s.registered_at desc, s.id desc
             limit $2 offset $3`,
            [searchPattern, limit, offset],
          )
        ).rows;

        return c.json({
          students,
          count: totalCount,
          limit,
          offset,
          hasMore: offset + students.length < totalCount,
          nextOffset: offset + students.length,
        });
      }

      if (path === "admin/students" && method === "POST") {
        const b = z
          .object({
            fullName: z.string().trim().min(2).max(150),
            phone,
            groupId: uuid,
          })
          .parse(await c.req.json());
        const g = (
          await db.query(
            "select * from school_app.groups where id=$1 and status='open' and exists(select 1 from school_app.licence_categories l where l.id=licence_category_id and l.is_active)",
            [b.groupId],
          )
        ).rows[0];
        if (!g) throw fail("INVALID_GROUP", 400);
        if (
          (
            await db.query(
              "select 1 from school_app.students where phone=$1",
              [b.phone],
            )
          ).rowCount
        ) {
          throw fail("PHONE_ALREADY_REGISTERED", 409);
        }
        const s = (
          await db.query(
            "insert into school_app.students(school_id,full_name,phone,licence_category_id) values($1,$2,$3,$4) returning *",
            [schoolId, b.fullName, b.phone, g.licence_category_id],
          )
        ).rows[0];
        await db.query(
          "insert into school_app.enrollments(school_id,student_id,group_id) values($1,$2,$3)",
          [schoolId, s.id, g.id],
        );
        const code = (
          await db.query("select school_app.create_invite($1) as code", [s.id])
        ).rows[0].code;
        return c.json({ ...(await dossier(db, s.id)), inviteCode: code }, 201);
      }

      const student = /^admin\/students\/([0-9a-f-]+)$/.exec(path);
      if (student && method === "GET")
        return c.json(await dossier(db, uuid.parse(student[1])));

      const invite = /^admin\/students\/([0-9a-f-]+)\/invite$/.exec(path);
      if (invite && method === "POST")
        return c.json({
          inviteCode: (
            await db.query("select school_app.create_invite($1) as code", [
              uuid.parse(invite[1]),
            ])
          ).rows[0].code,
        });

      if (path === "admin/payments" && method === "POST") {
        const rawBody = await c.req.json();
        if (
          rawBody &&
          typeof rawBody === "object" &&
          "receiptNumber" in rawBody &&
          rawBody.receiptNumber !== undefined &&
          rawBody.receiptNumber !== null &&
          (typeof rawBody.receiptNumber !== "string" ||
            !offlineReceiptRegex.test(rawBody.receiptNumber))
        ) {
          throw fail("INVALID_RECEIPT_NUMBER", 400);
        }
        const b = z
          .object({
            enrollmentId: uuid,
            amount: money,
            method: z.enum(["cash", "mtn_momo", "orange_money", "bank"]),
            reference: z.string().max(200).nullable().optional(),
            clientId: uuid,
            paidAt: z.string().datetime(),
            receiptNumber: z.string().regex(offlineReceiptRegex).optional(),
          })
          .parse(rawBody);
        const r = await db.query(
          "select * from school_app.record_payment($1,$2,$3,$4,$5,$6,$7)",
          [
            b.enrollmentId,
            b.amount,
            b.method,
            b.reference || null,
            b.clientId,
            b.paidAt,
            b.receiptNumber || null,
          ],
        );
        const enriched = (
          await db.query(
            `select ${enrichPaymentSql("p")} from school_app.payments p join school_app.enrollment_balances b on b.school_id=p.school_id and b.enrollment_id=p.enrollment_id where p.id=$1`,
            [r.rows[0].id],
          )
        ).rows[0];
        return c.json({ payment: enriched || r.rows[0] }, 201);
      }

      const cancel = /^admin\/payments\/([0-9a-f-]+)\/cancel$/.exec(path);
      if (cancel && method === "POST") {
        const b = z
          .object({ reason: z.string().trim().min(3).max(500) })
          .parse(await c.req.json());
        await db.query("select school_app.cancel_payment($1,$2)", [
          uuid.parse(cancel[1]),
          b.reason,
        ]);
        return c.json({ ok: true });
      }

      if (path === "admin/payments" && method === "GET") {
        const date = z
          .string()
          .regex(/^\d{4}-\d{2}(-\d{2})?$/)
          .parse(c.req.query("date"));
        const from = z.iso
          .date()
          .parse(date.length === 7 ? date + "-01" : date);
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(500000)
          .parse(c.req.query("offset") || 0);
        const span = date.length === 7 ? "1 month" : "1 day";
        const filter =
          "p.paid_at >= ($1::date::timestamp at time zone 'Africa/Douala') and p.paid_at < (($1::date + $2::interval)::timestamp at time zone 'Africa/Douala')";
        const summary = (
          await db.query(
            `select count(*)::int as count,coalesce(sum(p.amount) filter(where p.cancelled_at is null),0)::bigint as collected from school_app.payments p where ${filter}`,
            [from, span],
          )
        ).rows[0];
        const payments = (
          await db.query(
            `select ${enrichPaymentSql("p")},s.full_name as student_name,s.phone from school_app.payments p join school_app.enrollments e on e.school_id=p.school_id and e.id=p.enrollment_id join school_app.enrollment_balances b on b.school_id=p.school_id and b.enrollment_id=p.enrollment_id join school_app.students s on s.school_id=e.school_id and s.id=e.student_id where ${filter} order by p.paid_at desc,p.id desc limit 200 offset $3`,
            [from, span, offset],
          )
        ).rows;
        return c.json({
          payments,
          count: summary.count,
          collected: Number(summary.collected),
          hasMore: offset + payments.length < summary.count,
          nextOffset: offset + payments.length,
        });
      }

      if (path === "admin/groups" && method === "GET") {
        const groups = (
          await db.query(
            `select g.*,l.name as licence_name,(select count(distinct e.id)::int from school_app.enrollments e join school_app.payments p on p.school_id=e.school_id and p.enrollment_id=e.id and p.cancelled_at is null where e.school_id=g.school_id and e.group_id=g.id and e.status<>'cancelled') as confirmed_seats from school_app.groups g join school_app.licence_categories l on l.school_id=g.school_id and l.id=g.licence_category_id order by g.start_date desc, g.id desc`,
          )
        ).rows;
        const allInstallments = (
          await db.query(
            "select * from school_app.installments order by group_id, position",
          )
        ).rows;
        return c.json({
          groups: groups.map((g) => ({
            ...g,
            installments: allInstallments.filter((i) => i.group_id === g.id),
          })),
        });
      }

      if (path === "admin/groups" && method === "POST") {
        const b = z
          .object({
            name: z.string().trim().min(2).max(100),
            licenceCategoryId: uuid,
            startDate: z.iso.date(),
            scheduleText: z.string().max(200),
            capacity: z.number().int().min(1).max(1000),
            totalFee: money,
            installments: z
              .array(
                z.object({
                  label: z.string().min(1).max(100),
                  amount: money,
                  dueDate: z.iso.date(),
                }),
              )
              .min(1)
              .max(12),
          })
          .parse(await c.req.json());
        if (
          !(
            await db.query(
              "select id from school_app.licence_categories where id=$1 and is_active",
              [b.licenceCategoryId],
            )
          ).rowCount
        )
          throw fail("INVALID_GROUP", 400);
        if (
          b.installments.reduce((n, x) => n + x.amount, 0) !== b.totalFee ||
          b.installments.some(
            (x, i) => i > 0 && x.dueDate < b.installments[i - 1].dueDate,
          )
        )
          throw fail("INVALID_INSTALLMENTS", 400);
        const g = (
          await db.query(
            "insert into school_app.groups(school_id,licence_category_id,name,start_date,schedule_text,capacity,total_fee) values($1,$2,$3,$4,$5,$6,$7) returning *",
            [
              schoolId,
              b.licenceCategoryId,
              b.name,
              b.startDate,
              b.scheduleText,
              b.capacity,
              b.totalFee,
            ],
          )
        ).rows[0];
        const insertedInstallments = [];
        for (const [i, x] of b.installments.entries()) {
          const inst = (
            await db.query(
              "insert into school_app.installments(school_id,group_id,position,label,amount,due_date) values($1,$2,$3,$4,$5,$6) returning *",
              [schoolId, g.id, i + 1, x.label, x.amount, x.dueDate],
            )
          ).rows[0];
          insertedInstallments.push(inst);
        }
        return c.json(
          { group: { ...g, confirmed_seats: 0, installments: insertedInstallments } },
          201,
        );
      }

      const group = /^admin\/groups\/([0-9a-f-]+)$/.exec(path);
      if (group && method === "PATCH") {
        const b = z
          .object({ status: z.enum(["open", "closed", "finished"]) })
          .parse(await c.req.json());
        const updated = await db.query(
          "update school_app.groups set status=$2 where id=$1 returning id",
          [uuid.parse(group[1]), b.status],
        );
        if (!updated.rowCount) throw fail("GROUP_NOT_FOUND", 404);
        return c.json({ ok: true });
      }

      // Trusted Staff Content Authoring & Category Management
      if (path === "admin/categories" && method === "GET") {
        return c.json({
          categories: (
            await db.query(
              "select * from school_app.licence_categories order by code",
            )
          ).rows,
        });
      }
      if (path === "admin/categories" && method === "POST") {
        const b = z
          .object({
            code: z.string().trim().min(1).max(20),
            name: z.string().trim().min(2).max(100),
            isActive: z.boolean().optional().default(true),
          })
          .parse(await c.req.json());
        const r = await db.query(
          "select * from school_app.admin_save_category(null,$1,$2,$3)",
          [b.code, b.name, b.isActive],
        );
        return c.json({ category: r.rows[0] }, 201);
      }
      const categoryPatch = /^admin\/categories\/([0-9a-f-]+)$/.exec(path);
      if (categoryPatch && method === "PATCH") {
        const b = z
          .object({
            code: z.string().trim().min(1).max(20),
            name: z.string().trim().min(2).max(100),
            isActive: z.boolean().optional().default(true),
          })
          .parse(await c.req.json());
        const r = await db.query(
          "select * from school_app.admin_save_category($1,$2,$3,$4)",
          [uuid.parse(categoryPatch[1]), b.code, b.name, b.isActive],
        );
        return c.json({ category: r.rows[0] });
      }

      if (path === "admin/resources" && method === "GET") {
        return c.json({
          resources: (
            await db.query(
              "select * from school_app.resources order by title, id",
            )
          ).rows,
        });
      }
      if (path === "admin/resources/upload-url" && method === "POST") {
        const b = z
          .object({
            fileName: z
              .string()
              .trim()
              .regex(/^[a-zA-Z0-9._-]{1,120}$/),
            contentType: z
              .enum([
                "application/pdf",
                "video/mp4",
                "image/png",
                "image/jpeg",
                "image/webp",
              ])
              .default("application/pdf"),
          })
          .parse(await c.req.json());
        if (
          !c.env.R2_ACCOUNT_ID ||
          !c.env.R2_ACCESS_KEY_ID ||
          !c.env.R2_SECRET_ACCESS_KEY
        )
          throw fail("STORAGE_UNCONFIGURED", 503);
        const storagePath = `${schoolId}/resources/${randomUUID()}-${b.fileName}`;
        const s3 = new S3Client({
          region: "auto",
          endpoint: `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: c.env.R2_ACCESS_KEY_ID,
            secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
          },
        });
        const uploadUrl = await getSignedUrl(
          s3,
          new PutObjectCommand({
            Bucket: c.env.R2_BUCKET_NAME,
            Key: storagePath,
            ContentType: b.contentType,
          }),
          { expiresIn: 300 },
        );
        return c.json({ uploadUrl, storagePath, expiresIn: 300 }, 201);
      }
      if (path === "admin/resources" && method === "POST") {
        const b = z
          .object({
            licenceCategoryId: uuid,
            title: z.string().trim().min(2).max(200),
            description: z.string().max(1000).optional().default(""),
            type: z.enum(["pdf", "video", "link", "image"]).default("pdf"),
            storagePath: z.string().max(500).nullable().optional(),
            externalUrl: z.string().url().max(500).nullable().optional(),
            isPublished: z.boolean().optional().default(false),
          })
          .parse(await c.req.json());
        const r = await db.query(
          "select * from school_app.admin_save_resource(null,$1,$2,$3,$4,$5,$6,$7)",
          [
            b.licenceCategoryId,
            b.title,
            b.description,
            b.type,
            b.storagePath || null,
            b.externalUrl || null,
            b.isPublished,
          ],
        );
        return c.json({ resource: r.rows[0] }, 201);
      }
      const resourcePatch = /^admin\/resources\/([0-9a-f-]+)$/.exec(path);
      if (resourcePatch && method === "PATCH") {
        const resId = uuid.parse(resourcePatch[1]);
        const existing = (
          await db.query(
            "select * from school_app.resources where id=$1",
            [resId],
          )
        ).rows[0];
        if (!existing) throw fail("RESOURCE_NOT_FOUND", 404);
        const b = z
          .object({
            licenceCategoryId: uuid.optional(),
            title: z.string().trim().min(2).max(200).optional(),
            description: z.string().max(1000).optional(),
            type: z.enum(["pdf", "video", "link", "image"]).optional(),
            storagePath: z.string().max(500).nullable().optional(),
            externalUrl: z.string().url().max(500).nullable().optional(),
            isPublished: z.boolean().optional(),
          })
          .parse(await c.req.json());
        const r = await db.query(
          "select * from school_app.admin_save_resource($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            resId,
            b.licenceCategoryId ?? existing.licence_category_id,
            b.title ?? existing.title,
            b.description ?? existing.description,
            b.type ?? existing.type,
            b.storagePath !== undefined ? b.storagePath : existing.storage_path,
            b.externalUrl !== undefined ? b.externalUrl : existing.external_url,
            b.isPublished ?? existing.is_published,
          ],
        );
        return c.json({ resource: r.rows[0] });
      }

      if (path === "admin/quizzes" && method === "GET") {
        const quizzes = (
          await db.query(
            "select * from school_app.quizzes order by title, id",
          )
        ).rows;
        const questions = (
          await db.query(
            "select q as question from school_app.admin_list_questions(null) as q",
          )
        ).rows.map((r) => r.question);
        return c.json({
          quizzes: quizzes.map((q) => ({
            ...q,
            questions: questions.filter((x) => x.quiz_id === q.id),
          })),
        });
      }
      if (path === "admin/quizzes" && method === "POST") {
        const questionInput = z
          .object({
            body: z.string().trim().min(2).max(1000),
            options: z.array(z.string().trim().min(1).max(500)).min(2).max(6),
            correctIndex: z.number().int().min(0),
            imageUrl: z.string().max(500).nullable().optional(),
            explanation: z.string().max(2000).optional().default(""),
            position: z.number().int().min(1).optional(),
          })
          .superRefine((val, ctx) => {
            if (val.correctIndex >= val.options.length) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "INVALID_QUESTION_OPTIONS",
              });
            }
          });
        const b = z
          .object({
            licenceCategoryId: uuid,
            title: z.string().trim().min(2).max(200),
            durationMinutes: z.number().int().min(1).max(240),
            isPublished: z.boolean().optional().default(false),
            questions: z.array(questionInput).optional().default([]),
          })
          .parse(await c.req.json());

        if (b.isPublished && b.questions.length === 0) {
          throw fail("EMPTY_QUIZ", 400);
        }
        const qz = (
          await db.query(
            "select * from school_app.admin_save_quiz(null,$1,$2,$3,false)",
            [b.licenceCategoryId, b.title, b.durationMinutes],
          )
        ).rows[0];
        const savedQuestions = [];
        for (const [idx, q] of b.questions.entries()) {
          const sq = (
            await db.query(
              "select school_app.admin_save_question(null,$1,$2,$3,$4,$5,$6,$7) as question",
              [
                qz.id,
                q.body,
                JSON.stringify(q.options),
                q.correctIndex,
                q.imageUrl || null,
                q.explanation || "",
                q.position ?? idx + 1,
              ],
            )
          ).rows[0].question;
          savedQuestions.push(sq);
        }
        const finalQuiz = b.isPublished
          ? (
              await db.query(
                "select * from school_app.admin_save_quiz($1,$2,$3,$4,true)",
                [qz.id, b.licenceCategoryId, b.title, b.durationMinutes],
              )
            ).rows[0]
          : qz;
        return c.json(
          { quiz: { ...finalQuiz, questions: savedQuestions } },
          201,
        );
      }
      const quizPatch = /^admin\/quizzes\/([0-9a-f-]+)$/.exec(path);
      if (quizPatch && method === "PATCH") {
        const qzId = uuid.parse(quizPatch[1]);
        const existing = (
          await db.query("select * from school_app.quizzes where id=$1", [qzId])
        ).rows[0];
        if (!existing) throw fail("QUIZ_NOT_FOUND", 404);
        const b = z
          .object({
            licenceCategoryId: uuid.optional(),
            title: z.string().trim().min(2).max(200).optional(),
            durationMinutes: z.number().int().min(1).max(240).optional(),
            isPublished: z.boolean().optional(),
          })
          .parse(await c.req.json());
        const r = await db.query(
          "select * from school_app.admin_save_quiz($1,$2,$3,$4,$5)",
          [
            qzId,
            b.licenceCategoryId ?? existing.licence_category_id,
            b.title ?? existing.title,
            b.durationMinutes ?? existing.duration_minutes,
            b.isPublished ?? existing.is_published,
          ],
        );
        return c.json({ quiz: r.rows[0] });
      }
      const quizQuestionsPost = /^admin\/quizzes\/([0-9a-f-]+)\/questions$/.exec(
        path,
      );
      if (quizQuestionsPost && method === "POST") {
        const qzId = uuid.parse(quizQuestionsPost[1]);
        const raw = await c.req.json();
        const b = z
          .object({
            body: z.string().trim().min(2).max(1000),
            options: z.array(z.string().trim().min(1).max(500)).min(2).max(6),
            correctIndex: z.number().int().min(0),
            imageUrl: z.string().max(500).nullable().optional(),
            explanation: z.string().max(2000).optional().default(""),
            position: z.number().int().min(1),
          })
          .parse(raw);
        if (b.correctIndex >= b.options.length) {
          throw fail("INVALID_QUESTION_OPTIONS", 400);
        }
        const sq = (
          await db.query(
            "select school_app.admin_save_question(null,$1,$2,$3,$4,$5,$6,$7) as question",
            [
              qzId,
              b.body,
              JSON.stringify(b.options),
              b.correctIndex,
              b.imageUrl || null,
              b.explanation,
              b.position,
            ],
          )
        ).rows[0].question;
        return c.json({ question: sq }, 201);
      }

      if (path === "admin/settings" && method === "PATCH") {
        const b = z
          .object({
            name: z.string().min(2).max(150),
            address: z.string().max(300),
            phone: z.string().max(30),
            whatsapp: z.string().max(30),
            agrement_number: z.string().max(100),
            colors: z.object({
              primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
              accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            }),
          })
          .parse(await c.req.json());
        await db.query(
          "update school_app.schools set name=$1,address=$2,phone=$3,whatsapp=$4,agrement_number=$5,colors=$6 where id=$7",
          [
            b.name,
            b.address,
            b.phone,
            b.whatsapp,
            b.agrement_number,
            JSON.stringify(b.colors),
            schoolId,
          ],
        );
        return c.json({ ok: true });
      }
      throw fail("NOT_FOUND", 404);
    });
  } finally {
    await Promise.all([pool.end(), authPool.end()]);
  }
});

const statusByCode: Record<string, number> = {
  AUTH_REQUIRED: 401,
  ORIGIN_FORBIDDEN: 403,
  TURNSTILE_REQUIRED: 403,
  TURNSTILE_FAILED: 403,
  SESSION_IDENTITY_CHANGED: 403,
  MEMBERSHIP_REQUIRED: 403,
  ADMIN_REQUIRED: 403,
  PLATFORM_ADMIN_REQUIRED: 403,
  STUDENT_REQUIRED: 403,
  RESOURCE_FORBIDDEN: 403,
  QUIZ_FORBIDDEN: 403,
  SCHOOL_NOT_FOUND: 404,
  STUDENT_NOT_FOUND: 404,
  ENROLLMENT_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  GROUP_NOT_FOUND: 404,
  RESOURCE_NOT_FOUND: 404,
  QUIZ_NOT_FOUND: 404,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  RECEIPT_NUMBER_CONFLICT: 409,
  PHONE_ALREADY_REGISTERED: 409,
  STUDENT_ALREADY_REGISTERED: 409,
  STUDENT_ALREADY_ACTIVATED: 409,
  ENROLLMENT_ALREADY_EXISTS: 409,
  PAYMENT_ALREADY_CANCELLED: 409,
  SCHOOL_SLUG_CONFLICT: 409,
  CATEGORY_CODE_CONFLICT: 409,
  GROUP_FULL: 409,
  RATE_LIMITED: 429,
  STORAGE_UNCONFIGURED: 503,
  EMAIL_DELIVERY_UNAVAILABLE: 503,
  VALIDATION_ERROR: 400,
  INVALID_GROUP: 400,
  INVALID_LICENCE: 400,
  INVALID_INSTALLMENTS: 400,
  INVALID_INVITE: 400,
  INVALID_STUDENT: 400,
  INVALID_PAYMENT: 400,
  INVALID_RECEIPT_NUMBER: 400,
  EXCEEDS_BALANCE: 400,
  REASON_REQUIRED: 400,
  EMPTY_QUIZ: 400,
  INVALID_PLATFORM_ACTION: 400,
  INVALID_QUESTION_OPTIONS: 400,
};

app.onError((e, c) => {
  console.error("Worker error:", e);
  if (e instanceof z.ZodError) {
    const customIssue = e.issues.find(
      (i) => i.message && i.message in statusByCode,
    );
    if (customIssue) {
      const code = customIssue.message;
      return c.json({ error: code }, statusByCode[code] as 400);
    }
    return c.json({ error: "VALIDATION_ERROR" }, 400);
  }
  const pgErr = e as { code?: string; constraint?: string; message?: string };
  if (pgErr.code === "23505") {
    const constraint = pgErr.constraint || "";
    if (constraint.includes("phone"))
      return c.json({ error: "PHONE_ALREADY_REGISTERED" }, 409);
    if (constraint.includes("user_id"))
      return c.json({ error: "STUDENT_ALREADY_REGISTERED" }, 409);
    if (constraint.includes("receipt_number"))
      return c.json({ error: "RECEIPT_NUMBER_CONFLICT" }, 409);
    if (constraint.includes("slug"))
      return c.json({ error: "SCHOOL_SLUG_CONFLICT" }, 409);
    if (constraint.includes("code"))
      return c.json({ error: "CATEGORY_CODE_CONFLICT" }, 409);
    return c.json({ error: "CONFLICT" }, 409);
  }
  const code = e.message in statusByCode ? e.message : undefined;
  const status =
    (e as { status?: number }).status ||
    (code ? statusByCode[code] : 500);
  return c.json({ error: code || "REQUEST_FAILED" }, status as 400);
});

export default app;
