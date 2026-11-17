import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import {
  poolFor,
  tenantTransaction,
  type TenantBindings,
} from "../../src/tenant/context.js";
import { MAX_MATERIAL_BYTES } from "../../src/tenant/material-storage.js";
const url =
  process.env.TENANT_TEST_DATABASE_URL ||
  "postgresql://postgres:local_tenant_test@127.0.0.1:55436/postgres";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Disposable local PostgreSQL required");
const owner = new pg.Pool({ connectionString: url });
const school = randomUUID(),
  other = randomUUID(),
  cat = randomUUID(),
  foreignCat = randomUUID();
const slug = "content-" + school;
const env: TenantBindings = {
  DATABASE_URL: url.replace(/\/\/[^@]*@/, "//api_tenant_login:api_local_only@"),
  AUTH_DATABASE_URL: url.replace(
    /\/\/[^@]*@/,
    "//api_identity_login:identity_local_only@",
  ),
  BETTER_AUTH_URL: "http://localhost:8788",
  BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
  TRUSTED_ORIGINS: "http://localhost:4200",
  TURNSTILE_SECRET_KEY: "test-only",
  OFFLINE_PRIVATE_KEY_PEM: "",
  R2_ACCOUNT_ID: "synthetic",
  R2_ACCESS_KEY_ID: "synthetic-test",
  R2_SECRET_ACCESS_KEY: "synthetic-secret-only",
  R2_BUCKET_NAME: "synthetic-materials",
  ENVIRONMENT: "development",
  SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
};
let adminCookie = "",
  studentCookie = "",
  adminId = "",
  studentId = "";
let authPool: pg.Pool;
const req = (
  path: string,
  method = "GET",
  body?: unknown,
  cookie = adminCookie,
  schoolSlug = slug,
) =>
  app.request(
    `http://localhost:8788/api/schools/${schoolSlug}/${path}`,
    {
      method,
      headers: {
        Origin: "http://localhost:4200",
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
const question = (body = "Quel feu impose l’arrêt ?") => ({
  body,
  options: ["Rouge", "Vert"],
  correctIndex: 0,
  explanation: "Le rouge impose l’arrêt.",
});
beforeAll(async () => {
  await owner.query(
    await fs.readFile(
      new URL("../../migrations/001_multitenant.sql", import.meta.url),
      "utf8",
    ),
  );
  await owner.query(
    "do $$begin create role api_tenant_login login password 'api_local_only';exception when duplicate_object then null;end $$;grant aem_tenant_runtime to api_tenant_login;do $$begin create role api_identity_login login password 'identity_local_only';exception when duplicate_object then null;end $$;grant aem_identity_runtime to api_identity_login;",
  );
  await owner.query(
    "insert into school_app.schools(id,name,slug) values($1,'Synthetic authoring',$2),($3,'Synthetic other',$4)",
    [school, slug, other, "other-content-" + other],
  );
  await owner.query(
    "insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'B','Permis B'),($3,$4,'A','Permis A')",
    [cat, school, foreignCat, other],
  );
  authPool = poolFor(env, true);
  async function identity(role: "admin" | "student") {
    const r = await createAuth(env, authPool).api.signUpEmail({
      body: {
        email: randomUUID() + "@test.local",
        name: "Synthetic " + role,
        password: "LocalSynthetic123!",
      },
      headers: new Headers({ Origin: "http://localhost:4200" }),
      asResponse: true,
    });
    expect(r.ok).toBe(true);
    const id = (await r.json()).user.id as string;
    await owner.query(
      "insert into school_app.school_members values($1,$2,$3)",
      [school, id, role],
    );
    return {
      id,
      cookie: r.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; "),
    };
  }
  const a = await identity("admin"),
    s = await identity("student");
  adminCookie = a.cookie;
  adminId = a.id;
  studentCookie = s.cookie;
  studentId = s.id;
  await owner.query(
    "insert into school_app.school_members values($1,$2,'admin')",
    [other, adminId],
  );
  await owner.query(
    "insert into school_app.students(school_id,user_id,full_name,phone,licence_category_id) values($1,$2,'Synthetic learner','+237699123456',$3)",
    [school, studentId, cat],
  );
}, 60000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await authPool?.end();
  await owner.end();
});
function storage(
  size = 20,
  mime = "application/pdf",
  bytes = "%PDF-1.7 synthetic",
) {
  return vi.spyOn(S3Client.prototype, "send").mockImplementation((async (
    command: unknown,
  ) => {
    if (command instanceof HeadObjectCommand)
      return { ContentLength: size, ContentType: mime };
    if (command instanceof GetObjectCommand)
      return {
        Body: {
          transformToByteArray: async () => new TextEncoder().encode(bytes),
        },
      };
    throw new Error("Unexpected storage operation");
  }) as any);
}
it("denies anonymous and student authoring, listing, previews and upload signing", async () => {
  for (const [path, method, body] of [
    ["admin/resources", "GET", undefined],
    ["admin/quizzes", "GET", undefined],
    ["admin/resources", "POST", {}],
    ["admin/quizzes", "POST", {}],
    ["admin/resources/upload-url", "POST", {}],
    [`admin/resources/${randomUUID()}/url`, "GET", undefined],
  ] as const) {
    expect((await req(path, method, body, "")).status).toBe(401);
    expect((await req(path, method, body, studentCookie)).status).toBe(403);
  }
});
it("creates, previews, edits and unpublishes school-scoped course links; drafts stay hidden", async () => {
  const r = await req("admin/resources", "POST", {
    licenceCategoryId: cat,
    title: "Priorités",
    description: "Cours synthétique",
    type: "link",
    externalUrl: "https://example.org/cours",
    isPublished: false,
  });
  expect(r.status).toBe(201);
  const item = (await r.json()).resource;
  expect(
    (await (await req("resources", "GET", undefined, studentCookie)).json())
      .resources,
  ).not.toContainEqual(expect.objectContaining({ id: item.id }));
  expect(
    (await req(`resources/${item.id}/url`, "GET", undefined, studentCookie))
      .status,
  ).toBe(403);
  expect((await req(`admin/resources/${item.id}/url`)).status).toBe(200);
  expect(
    (
      await req(`admin/resources/${item.id}`, "PATCH", {
        title: "Priorités routières",
        isPublished: true,
      })
    ).status,
  ).toBe(200);
  expect(
    (await (await req("resources", "GET", undefined, studentCookie)).json())
      .resources,
  ).toContainEqual(
    expect.objectContaining({ id: item.id, title: "Priorités routières" }),
  );
  expect(
    (await req(`resources/${item.id}/url`, "GET", undefined, studentCookie))
      .status,
  ).toBe(200);
  expect(
    (await req(`admin/resources/${item.id}`, "PATCH", { isPublished: false }))
      .status,
  ).toBe(200);
  expect(
    (await req(`resources/${item.id}/url`, "GET", undefined, studentCookie))
      .status,
  ).toBe(403);
  // The same admin in both schools still cannot address school A's row through school B.
  for (const [path, method, body] of [
    [`admin/resources/${item.id}/url`, "GET", undefined],
    [`admin/resources/${item.id}`, "PATCH", { title: "Forbidden" }],
  ] as const)
    expect(
      (await req(path, method, body, adminCookie, "other-content-" + other))
        .status,
    ).toBe(404);
  expect(
    (
      await req("admin/resources", "POST", {
        licenceCategoryId: foreignCat,
        title: "Wrong category",
        type: "link",
        externalUrl: "https://example.org/",
      })
    ).status,
  ).toBe(400);
});
it("signs size-bounded school-prefixed private uploads without returning credentials", async () => {
  for (const body of [
    { fileName: "x.pdf", contentType: "application/pdf" },
    { fileName: "x.pdf", contentType: "text/html", size: 10 },
    { fileName: "../x.pdf", contentType: "application/pdf", size: 10 },
    {
      fileName: "x.pdf",
      contentType: "application/pdf",
      size: MAX_MATERIAL_BYTES + 1,
    },
  ])
    expect((await req("admin/resources/upload-url", "POST", body)).status).toBe(
      400,
    );
  const r = await req("admin/resources/upload-url", "POST", {
    fileName: "cours.pdf",
    contentType: "application/pdf",
    size: 20,
  });
  expect(r.status).toBe(201);
  const data = await r.json();
  expect(data.storagePath.startsWith(school + "/resources/")).toBe(true);
  expect(data.uploadUrl).toContain("X-Amz-Signature");
  const signed = new URL(data.uploadUrl);
  expect(signed.searchParams.get("X-Amz-SignedHeaders")).toContain(
    "content-length",
  );
  expect(signed.searchParams.get("X-Amz-SignedHeaders")).toContain(
    "content-type",
  );
  expect(signed.searchParams.get("X-Amz-SignedHeaders")).toContain(
    "if-none-match",
  );
  expect(signed.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(signed.searchParams.has("x-amz-checksum-crc32")).toBe(false);

  expect(JSON.stringify(data)).not.toContain(env.R2_SECRET_ACCESS_KEY);
});
it("checks actual R2 size, content type, file signature and school ownership before saving", async () => {
  const body = {
    licenceCategoryId: cat,
    title: "Document privé",
    type: "pdf",
    storagePath: school + "/resources/" + randomUUID() + "-cours.pdf",
  };
  let mock = storage();
  expect((await req("admin/resources", "POST", body)).status).toBe(201);
  mock.mockRestore();
  mock = storage(MAX_MATERIAL_BYTES + 1);
  expect((await req("admin/resources", "POST", body)).status).toBe(400);
  mock.mockRestore();
  mock = storage(20, "text/html");
  expect((await req("admin/resources", "POST", body)).status).toBe(400);
  mock.mockRestore();
  mock = storage(20, "application/pdf", "<html>fake pdf");
  expect((await req("admin/resources", "POST", body)).status).toBe(400);
  mock.mockRestore();
  mock = storage();
  expect(
    (
      await req("admin/resources", "POST", {
        ...body,
        storagePath: other + "/resources/x.pdf",
      })
    ).status,
  ).toBe(403);
  expect(mock).not.toHaveBeenCalled();
});
it("rejects traversal-shaped storage keys before accessing R2", async () => {
  const mock = storage();
  const r = await req("admin/resources", "POST", {
    licenceCategoryId: cat,
    title: "Invalid key",
    type: "pdf",
    storagePath: school + "/resources/../../" + other + "/x.pdf",
  });
  expect(r.status).toBe(403);
  expect(mock).not.toHaveBeenCalled();
});
it("does not save storage objects when private storage is unavailable", async () => {
  const mock = vi
    .spyOn(S3Client.prototype, "send")
    .mockRejectedValue(new Error("synthetic outage"));
  const r = await req("admin/resources", "POST", {
    licenceCategoryId: cat,
    title: "Unavailable",
    type: "pdf",
    storagePath: school + "/resources/" + randomUUID() + "-x.pdf",
  });
  expect(r.status).toBe(503);
  expect((await r.json()).error).toBe("STORAGE_UNAVAILABLE");
  expect(mock).toHaveBeenCalled();
});
it("creates and atomically edits quiz questions, validates answers, previews drafts and scopes IDs", async () => {
  const r = await req("admin/quizzes", "POST", {
    licenceCategoryId: cat,
    title: "Signalisation",
    durationMinutes: 15,
    questions: [question()],
  });
  expect(r.status).toBe(201);
  const quiz = (await r.json()).quiz;
  expect((await (await req("admin/quizzes")).json()).quizzes).toContainEqual(
    expect.objectContaining({ id: quiz.id }),
  );
  expect(
    (await (await req("quizzes", "GET", undefined, studentCookie)).json())
      .quizzes,
  ).not.toContainEqual(expect.objectContaining({ id: quiz.id }));
  const q = {
    ...question("Que signifie le feu rouge ?"),
    id: quiz.questions[0].id,
  };
  expect(
    (
      await req(`admin/quizzes/${quiz.id}`, "PATCH", {
        questions: [q, question("Que signifie le feu vert ?")],
        isPublished: true,
      })
    ).status,
  ).toBe(200);
  const published = (
    await (await req("quizzes", "GET", undefined, studentCookie)).json()
  ).quizzes.find((x: any) => x.id === quiz.id);
  expect(published.questions).toHaveLength(2);
  expect(JSON.stringify(published)).not.toContain("correct_index");
  expect(
    (
      await req(`admin/quizzes/${quiz.id}`, "PATCH", {
        questions: [{ ...q, correctIndex: 9 }],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await req(`admin/quizzes/${quiz.id}`, "PATCH", {
        questions: [],
        isPublished: true,
      })
    ).status,
  ).toBe(400);
  expect(
    (await (await req("admin/quizzes")).json()).quizzes.find(
      (x: any) => x.id === quiz.id,
    ).questions,
  ).toHaveLength(2);
  expect(
    (await req(`admin/quizzes/${quiz.id}`, "PATCH", { isPublished: false }))
      .status,
  ).toBe(200);
  expect(
    (
      await req(
        `admin/quizzes/${quiz.id}`,
        "PATCH",
        { isPublished: true },
        adminCookie,
        "other-content-" + other,
      )
    ).status,
  ).toBe(404);
  const foreign = await req(
    "admin/quizzes",
    "POST",
    {
      licenceCategoryId: foreignCat,
      title: "Other quiz",
      durationMinutes: 10,
      questions: [question()],
    },
    adminCookie,
    "other-content-" + other,
  );
  const foreignQuiz = (await foreign.json()).quiz;
  expect(
    (
      await req(`admin/quizzes/${quiz.id}`, "PATCH", {
        questions: [{ ...question(), id: foreignQuiz.questions[0].id }],
      })
    ).status,
  ).toBe(404);
  expect(
    (await req(`admin/quizzes/${quiz.id}`, "PATCH", { questions: [q, q] }))
      .status,
  ).toBe(400);
});
it("preserves questions once students have submitted attempts", async () => {
  const r = await req("admin/quizzes", "POST", {
    licenceCategoryId: cat,
    title: "Quiz à conserver",
    durationMinutes: 10,
    questions: [question()],
    isPublished: true,
  });
  expect(r.status).toBe(201);
  const quiz = (await r.json()).quiz;
  const attempt = await req(
    "quiz-attempts",
    "POST",
    {
      quizId: quiz.id,
      clientId: randomUUID(),
      takenAt: new Date().toISOString(),
      answers: { [quiz.questions[0].id]: "0" },
    },
    studentCookie,
  );
  expect(attempt.status).toBe(201);
  expect(
    (
      await req(`admin/quizzes/${quiz.id}`, "PATCH", {
        questions: [question("Un autre énoncé")],
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await req(`admin/quizzes/${quiz.id}`, "PATCH", {
        title: "Titre corrigé",
        isPublished: false,
      })
    ).status,
  ).toBe(200);
});

it("denies expired unpaid students published materials and new quiz submissions", async () => {
  const resource = (
    await (
      await req("admin/resources", "POST", {
        licenceCategoryId: cat,
        title: "Cours réservé",
        type: "link",
        externalUrl: "https://example.org/reserved",
        isPublished: true,
      })
    ).json()
  ).resource;
  const quiz = (
    await (
      await req("admin/quizzes", "POST", {
        licenceCategoryId: cat,
        title: "Évaluation réservée",
        durationMinutes: 10,
        questions: [question()],
        isPublished: true,
      })
    ).json()
  ).quiz;
  await owner.query(
    "update school_app.students set trial_ends_at=now()-interval '1 day' where school_id=$1 and user_id=$2",
    [school, studentId],
  );
  try {
    expect(
      (
        await req(
          `resources/${resource.id}/url`,
          "GET",
          undefined,
          studentCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await (await req("quizzes", "GET", undefined, studentCookie)).json())
        .quizzes,
    ).toHaveLength(0);
    expect(
      (
        await req(
          "quiz-attempts",
          "POST",
          {
            quizId: quiz.id,
            clientId: randomUUID(),
            takenAt: new Date().toISOString(),
            answers: { [quiz.questions[0].id]: "0" },
          },
          studentCookie,
        )
      ).status,
    ).toBe(403);
  } finally {
    await owner.query(
      "update school_app.students set trial_ends_at=now()+interval '14 days' where school_id=$1 and user_id=$2",
      [school, studentId],
    );
  }
});

it("rejects stale quiz versions while preserving identical submitted retries", async () => {
  const draftResponse = await req("admin/quizzes", "POST", {
    licenceCategoryId: cat,
    title: "Version de brouillon",
    durationMinutes: 10,
    questions: [question()],
  });
  expect(draftResponse.status).toBe(201);
  const draft = (await draftResponse.json()).quiz;
  const listed = (await (await req("admin/quizzes")).json()).quizzes.find(
    (q: any) => q.id === draft.id,
  );
  expect(draft.content_version).toBe(listed.content_version);

  const created = await req("admin/quizzes", "POST", {
    licenceCategoryId: cat,
    title: "Version de référence",
    durationMinutes: 10,
    questions: [question()],
    isPublished: true,
  });
  expect(created.status).toBe(201);
  const quiz = (await created.json()).quiz;
  const old = (
    await (await req("quizzes", "GET", undefined, studentCookie)).json()
  ).quizzes.find((q: any) => q.id === quiz.id);
  expect(old.content_version).toBeGreaterThan(0);
  expect(
    (
      await req(`admin/quizzes/${quiz.id}`, "PATCH", {
        questions: [
          { ...question("Question révisée"), id: quiz.questions[0].id },
        ],
      })
    ).status,
  ).toBe(200);
  const body = {
    quizId: quiz.id,
    quizVersion: old.content_version,
    clientId: randomUUID(),
    takenAt: new Date().toISOString(),
    answers: { [quiz.questions[0].id]: "0" },
  };
  const rejected = await req("quiz-attempts", "POST", body, studentCookie);
  expect(rejected.status).toBe(409);
  expect((await rejected.json()).error).toBe("QUIZ_VERSION_CHANGED");
  const current = (
    await (await req("quizzes", "GET", undefined, studentCookie)).json()
  ).quizzes.find((q: any) => q.id === quiz.id);
  const acceptedBody = { ...body, quizVersion: current.content_version };
  const accepted = await req(
    "quiz-attempts",
    "POST",
    acceptedBody,
    studentCookie,
  );
  expect(accepted.status).toBe(201);
  const attempt = (await accepted.json()).attempt;
  await req(`admin/quizzes/${quiz.id}`, "PATCH", { title: "Titre mis à jour" });
  const retry = await req("quiz-attempts", "POST", acceptedBody, studentCookie);
  expect(retry.status).toBe(201);
  expect((await retry.json()).attempt.id).toBe(attempt.id);
});

async function storageSchool(quota: number) {
  const id = randomUUID(),
    category = randomUUID(),
    schoolSlug = "storage-review-" + id;
  await owner.query(
    "insert into school_app.schools(id,name,slug,storage_quota_bytes) values($1,'Synthetic storage school',$2,$3)",
    [id, schoolSlug, quota],
  );
  await owner.query(
    "insert into school_app.school_members values($1,$2,'admin')",
    [id, adminId],
  );
  await owner.query(
    "insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'B','Permis B')",
    [category, id],
  );
  return {
    id,
    category,
    request: (path: string, method = "GET", body?: unknown) =>
      req(path, method, body, adminCookie, schoolSlug),
  };
}
it("stores immutable issuance snapshots and preserves them through retries and later edits", async () => {
  const s = await storageSchool(100),
    group = randomUUID();
  await owner.query(
    "insert into school_app.groups(id,school_id,licence_category_id,name,capacity,total_fee) values($1,$2,$3,'Receipt review',20,10000)",
    [group, s.id, s.category],
  );
  const created = await s.request("admin/students", "POST", {
    fullName: "Original student",
    phone: "+237699987654",
    groupId: group,
  });
  expect(created.status).toBe(201);
  const d = await created.json();
  const body = {
    enrollmentId: d.enrollment.id,
    amount: 1000,
    method: "cash",
    clientId: randomUUID(),
    paidAt: new Date().toISOString(),
  };
  const response = await s.request("admin/payments", "POST", body);
  expect(response.status).toBe(201);
  const p = (await response.json()).payment;
  expect(p.snapshot_provenance).toBe("recorded_at_issuance");
  expect(p.issuance_snapshot.student.name).toBe("Original student");
  expect(p.issuance_snapshot.balanceAtIssuance).toBe(9000);
  await owner.query(
    "update school_app.students set full_name='Renamed student' where id=$1",
    [d.student.id],
  );
  await owner.query(
    "update school_app.schools set name='Renamed school' where id=$1",
    [s.id],
  );
  const retry = await s.request("admin/payments", "POST", body);
  expect(retry.status).toBe(201);
  const repeated = (await retry.json()).payment;
  expect(repeated.id).toBe(p.id);
  expect(repeated.issuance_snapshot).toEqual(p.issuance_snapshot);
  const dossier = await s.request("admin/students/" + d.student.id);
  expect((await dossier.json()).payments[0].issuance_snapshot).toEqual(
    p.issuance_snapshot,
  );
  await expect(
    owner.query(
      "update school_app.payments set issuance_snapshot='{}'::jsonb where id=$1",
      [p.id],
    ),
  ).rejects.toThrow("APPEND_ONLY");
});
it("keeps saved and replacement files counted after reservation expiry", async () => {
  const s = await storageSchool(40);
  storage();
  const sign = async (name: string) => {
    const r = await s.request("admin/resources/upload-url", "POST", {
      fileName: name,
      contentType: "application/pdf",
      size: 20,
    });
    expect(r.status).toBe(201);
    return (await r.json()).storagePath as string;
  };
  const first = await sign("original.pdf");
  const saved = await s.request("admin/resources", "POST", {
    licenceCategoryId: s.category,
    title: "Original material",
    type: "pdf",
    storagePath: first,
  });
  expect(saved.status).toBe(201);
  const resource = (await saved.json()).resource;
  const second = await sign("replacement.pdf");
  expect(
    (
      await s.request("admin/resources/" + resource.id, "PATCH", {
        storagePath: second,
      })
    ).status,
  ).toBe(200);
  await owner.query(
    "update school_app.storage_uploads set created_at=now()-interval '2 hours' where school_id=$1",
    [s.id],
  );
  const tracking = (
    await owner.query(
      "select status from school_app.storage_uploads where school_id=$1",
      [s.id],
    )
  ).rows;
  expect(tracking).toHaveLength(2);
  expect(tracking.every((r) => r.status === "finalized")).toBe(true);
  const excess = await s.request("admin/resources/upload-url", "POST", {
    fileName: "over.pdf",
    contentType: "application/pdf",
    size: 1,
  });
  expect(excess.status).toBe(409);
  expect((await excess.json()).error).toBe("STORAGE_QUOTA_EXCEEDED");
});
it("serializes competing upload reservations at the school quota", async () => {
  const s = await storageSchool(20);
  const results = await Promise.all(
    ["a.pdf", "b.pdf"].map((fileName) =>
      s.request("admin/resources/upload-url", "POST", {
        fileName,
        contentType: "application/pdf",
        size: 20,
      }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    Number(
      (
        await owner.query(
          "select sum(size_bytes) as total from school_app.storage_uploads where school_id=$1",
          [s.id],
        )
      ).rows[0].total,
    ),
  ).toBe(20);
});
it("does not let a student read or create internal upload-tracking rows", async () => {
  const pool = poolFor(env);
  try {
    const rows = await tenantTransaction(pool, school, studentId, (c) =>
      c.query("select * from school_app.storage_uploads"),
    );
    expect(rows.rows).toEqual([]);
    await expect(
      tenantTransaction(pool, school, studentId, (c) =>
        c.query(
          "insert into school_app.storage_uploads(school_id,storage_path,size_bytes,content_type) values($1,$2,20,'application/pdf')",
          [school, school + "/resources/" + randomUUID() + "-denied.pdf"],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  } finally {
    await pool.end();
  }
});
