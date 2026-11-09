import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SignJWT, importPKCS8, exportJWK, importSPKI } from "jose";
import { createPublicKey } from "node:crypto";
import type pg from "pg";
import { poolFor, tenantTransaction, type TenantBindings } from "./context.js";
import { createAuth } from "./auth.js";
const app = new Hono<{ Bindings: TenantBindings }>();
const uuid = z.string().uuid();
const money = z.number().int().positive().max(1_000_000_000);
const phone = z.string().regex(/^\+237[26][0-9]{8}$/);
const fail = (code: string, status = 400) =>
  Object.assign(new Error(code), { status });
app.use("*", bodyLimit({ maxSize: 1024 * 1024 }));
app.use("*", async (c, next) =>
  cors({
    origin: (origin) =>
      (c.env.TRUSTED_ORIGINS || "").split(",").includes(origin) ? origin : "",
    credentials: true,
  })(c, next),
);
app.use("*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (!origin || !(c.env.TRUSTED_ORIGINS || "").split(",").includes(origin))
      return c.json({ error: "ORIGIN_FORBIDDEN" }, 403);
  }
  await next();
});
app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/config", (c) =>
  c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || "" }),
);
app.all("/api/auth/*", async (c) => {
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
  }
  const pool = poolFor(c.env, true);
  try {
    return await createAuth(c.env, pool).handler(c.req.raw);
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
    `select b.enrollment_id as id,b.* from school_app.enrollment_balances b join school_app.enrollments e on e.school_id=b.school_id and e.id=b.enrollment_id where b.student_id=$1 order by e.created_at desc limit 1`,
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
          "select * from school_app.payments where enrollment_id=$1 order by paid_at desc",
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
    const session = await createAuth(c.env, authPool).api.getSession({
      headers: c.req.raw.headers,
    });
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
      if (path === "catalogue" && method === "GET")
        return c.json({
          school,
          categories: (
            await db.query(
              "select * from school_app.licence_categories where is_active order by code",
            )
          ).rows,
          groups: (
            await db.query(
              "select g.*,lc.name as licence_name from school_app.groups g join school_app.licence_categories lc on lc.school_id=g.school_id and lc.id=g.licence_category_id where g.status='open' order by g.start_date",
            )
          ).rows,
        });
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
            "select id,title,description,type from school_app.resources where is_published order by title",
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
          return c.json({ url: r.external_url });
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
        });
      }
      if (path === "quizzes" && method === "GET") {
        const quizzes = (
          await db.query(
            "select id,title,duration_minutes from school_app.quizzes where is_published order by title",
          )
        ).rows;
        const questions = (
          await db.query(
            "select id,quiz_id,body,options,image_url,position from school_app.questions order by position",
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
        return c.json({ attempt: r.rows[0] }, 201);
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
              "select p.*,s.full_name as student_name,s.phone from school_app.payments p join school_app.enrollments e on e.school_id=p.school_id and e.id=p.enrollment_id join school_app.students s on s.school_id=e.school_id and s.id=e.student_id order by p.paid_at desc limit 10",
            )
          ).rows,
        });
      }
      if (path === "admin/students" && method === "GET")
        return c.json({
          students: (
            await db.query(
              `select s.*,b.enrollment_id,b.group_name,b.balance,b.paid,b.total_fee from school_app.students s left join lateral(select * from school_app.enrollment_balances b where b.student_id=s.id order by b.enrollment_id limit 1)b on true where s.full_name ilike $1 or s.phone ilike $1 order by s.registered_at desc limit 200`,
              ["%" + (c.req.query("search") || "").slice(0, 100) + "%"],
            )
          ).rows,
        });
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
        if (!g) throw fail("INVALID_GROUP");
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
        const b = z
          .object({
            enrollmentId: uuid,
            amount: money,
            method: z.enum(["cash", "mtn_momo", "orange_money", "bank"]),
            reference: z.string().max(200).nullable().optional(),
            clientId: uuid,
            paidAt: z.string().datetime(),
            receiptNumber: z
              .string()
              .regex(/^RC-[A-Z0-9]+-[0-9]+$/)
              .optional(),
          })
          .parse(await c.req.json());
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
        return c.json({ payment: r.rows[0] }, 201);
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
            `select p.*,s.full_name as student_name,s.phone from school_app.payments p join school_app.enrollments e on e.school_id=p.school_id and e.id=p.enrollment_id join school_app.students s on s.school_id=e.school_id and s.id=e.student_id where ${filter} order by p.paid_at desc,p.id limit 200 offset $3`,
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
      if (path === "admin/groups" && method === "GET")
        return c.json({
          groups: (
            await db.query(
              `select g.*,l.name as licence_name,(select count(distinct e.id) from school_app.enrollments e join school_app.payments p on p.school_id=e.school_id and p.enrollment_id=e.id and p.cancelled_at is null where e.school_id=g.school_id and e.group_id=g.id and e.status<>'cancelled') as confirmed_seats from school_app.groups g join school_app.licence_categories l on l.school_id=g.school_id and l.id=g.licence_category_id order by g.start_date desc`,
            )
          ).rows,
        });
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
          throw fail("INVALID_GROUP");
        if (
          b.installments.reduce((n, x) => n + x.amount, 0) !== b.totalFee ||
          b.installments.some(
            (x, i) => i > 0 && x.dueDate < b.installments[i - 1].dueDate,
          )
        )
          throw fail("INVALID_INSTALLMENTS");
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
        for (const [i, x] of b.installments.entries())
          await db.query(
            "insert into school_app.installments(school_id,group_id,position,label,amount,due_date) values($1,$2,$3,$4,$5,$6)",
            [schoolId, g.id, i + 1, x.label, x.amount, x.dueDate],
          );
        return c.json({ group: g }, 201);
      }
      const group = /^admin\/groups\/([0-9a-f-]+)$/.exec(path);
      if (group && method === "PATCH") {
        const b = z
          .object({ status: z.enum(["open", "closed", "finished"]) })
          .parse(await c.req.json());
        await db.query("update school_app.groups set status=$2 where id=$1", [
          uuid.parse(group[1]),
          b.status,
        ]);
        return c.json({ ok: true });
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
app.onError((e, c) => {
  if (e instanceof z.ZodError)
    return c.json({ error: "VALIDATION_ERROR" }, 400);
  const known = [
    "SESSION_IDENTITY_CHANGED",
    "AUTH_REQUIRED",
    "PLATFORM_ADMIN_REQUIRED",
    "ADMIN_REQUIRED",
    "SCHOOL_NOT_FOUND",
    "STUDENT_NOT_FOUND",
    "MEMBERSHIP_REQUIRED",
    "RESOURCE_FORBIDDEN",
    "STORAGE_UNCONFIGURED",
    "INVALID_GROUP",
    "INVALID_INVITE",
    "EXCEEDS_BALANCE",
    "GROUP_FULL",
    "IDEMPOTENCY_CONFLICT",
    "INVALID_INSTALLMENTS",
    "NOT_FOUND",
  ];
  const code = known.find((k) => e.message === k);
  const status =
    (e as { status?: number }).status ||
    (code === "ADMIN_REQUIRED" ? 403 : code ? 400 : 500);
  return c.json({ error: code || "REQUEST_FAILED" }, status as 400);
});
export default app;
