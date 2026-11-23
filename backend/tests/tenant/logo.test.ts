import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { createAuth } from "../../src/tenant/auth.js";
import { poolFor, type TenantBindings } from "../../src/tenant/context.js";
import { deflateSync } from "node:zlib";

// School logos: uploaded in Paramètres, served publicly, used in previews.
const url =
  process.env.TENANT_TEST_DATABASE_URL ||
  "postgresql://postgres:local_tenant_test@127.0.0.1:55436/postgres";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Disposable local database required");
const owner = new pg.Pool({ connectionString: url });
const school = randomUUID(),
  other = randomUUID(),
  cat = randomUUID(),
  group = randomUUID();
const slug = "logo-" + school.slice(0, 8);
const otherSlug = "logo-o-" + other.slice(0, 8);
let adminCookie = "";
let adminId = "";
let authPool: pg.Pool;
const env: TenantBindings = {
  DATABASE_URL: url.replace(/\/\/[^@]*@/, "//api_tenant_login:api_local_only@"),
  AUTH_DATABASE_URL: url.replace(/\/\/[^@]*@/, "//api_identity_login:identity_local_only@"),
  BETTER_AUTH_URL: "http://localhost:8788",
  BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
  TRUSTED_ORIGINS: "http://localhost:4200",
  TURNSTILE_SECRET_KEY: "test-only",
  OFFLINE_PRIVATE_KEY_PEM: generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
  ENVIRONMENT: "development",
  SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  R2_ACCOUNT_ID: "",
  R2_ACCESS_KEY_ID: "",
  R2_SECRET_ACCESS_KEY: "",
  R2_BUCKET_NAME: "",
};
const call = (path: string, method = "GET", body?: unknown, cookie = "", schoolSlug = slug) =>
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
const cookieOf = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
let phoneSeq = 10000000;
const newPhone = () => "+2376" + String(phoneSeq++).padStart(8, "0");

async function deskCreatesStudent(phone: string) {
  const r = await call(
    "admin/students",
    "POST",
    { fullName: "Élève " + phone.slice(-4), phone, groupId: group },
    adminCookie,
  );
  expect(r.status).toBe(201);
  const b = await r.json();
  return { id: b.student.id as string, code: b.inviteCode as string };
}

beforeAll(async () => {
  await owner.query(
    await fs.readFile(new URL("../../migrations/001_multitenant.sql", import.meta.url), "utf8"),
  );
  await owner.query(
    "do $$begin create role api_tenant_login login password 'api_local_only';exception when duplicate_object then null;end $$;grant aem_tenant_runtime to api_tenant_login;do $$begin create role api_identity_login login password 'identity_local_only';exception when duplicate_object then null;end $$;grant aem_identity_runtime to api_identity_login;",
  );
  await owner.query(
    "insert into school_app.schools(id,name,slug) values($1,'Phone school',$2),($3,'Other phone school',$4)",
    [school, slug, other, otherSlug],
  );
  await owner.query(
    "insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'B','Permis B')",
    [cat, school],
  );
  await owner.query(
    "insert into school_app.groups(id,school_id,licence_category_id,name,capacity,total_fee) values($1,$2,$3,'Groupe',50,100000)",
    [group, school, cat],
  );
  authPool = poolFor(env, true);
  const response = (await createAuth(env, authPool).api.signUpEmail({
    body: { email: school + "@test.local", name: "Desk", password: "TestPassword123!" },
    headers: new Headers({ Origin: "http://localhost:4200" }),
    asResponse: true,
  })) as Response;
  adminCookie = cookieOf(response);
  const admin = ((await response.json()) as { user: { id: string } }).user.id;
  adminId = admin;
  await owner.query("insert into school_app.school_members values($1,$2,'admin')", [school, admin]);
}, 60000);
afterAll(async () => {
  await authPool?.end();
  await owner.end();
});



/** A real 2x2 PNG. */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const td = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const c = Buffer.alloc(4); c.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;
const get = (path: string) => app.request("https://aem.example" + path, {}, { ...env, ENVIRONMENT: "production", ASSETS: { fetch: async () => new Response("<html><head><title>x</title></head><body><app-root></app-root></body></html>") } });

it("an admin uploads a logo; it is served publicly and used in link previews", async () => {
  const r = await call("admin/settings/logo", "PUT", { dataUrl: dataUrl("image/png", png()) }, adminCookie);
  expect(r.status).toBe(200);
  const { logo } = await r.json();
  expect(logo).toMatch(new RegExp(`^/api/schools/${slug}/logo\\?v=\\d+$`));
  const served = await get(logo);
  expect(served.status).toBe(200);
  expect(served.headers.get("Content-Type")).toBe("image/png");
  expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(Buffer.from(await served.arrayBuffer()).equals(png())).toBe(true);
  const cat = await (await call("catalogue")).json();
  expect(cat.school.logo).toBe(logo);
  const page = await (await get(`/s/${slug}`)).text();
  expect(page).toContain(`property="og:image" content="https://aem.example${logo}"`);
});

it("rejects SVG, disguised files and oversized images; only admins can change the logo", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  expect((await call("admin/settings/logo", "PUT", { dataUrl: dataUrl("image/svg+xml", svg) }, adminCookie)).status).toBe(400);
  // Declared PNG but JPEG bytes.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
  expect((await call("admin/settings/logo", "PUT", { dataUrl: dataUrl("image/png", jpeg) }, adminCookie)).status).toBe(400);
  const huge = Buffer.concat([png(), Buffer.alloc(310 * 1024)]);
  expect((await call("admin/settings/logo", "PUT", { dataUrl: dataUrl("image/png", huge) }, adminCookie)).status).toBe(400);
  expect((await call("admin/settings/logo", "PUT", { dataUrl: dataUrl("image/png", png()) })).status).toBe(401);
});

it("removing the logo restores the default preview and the endpoint returns 404", async () => {
  expect((await call("admin/settings/logo", "DELETE", undefined, adminCookie)).status).toBe(200);
  expect((await (await call("catalogue")).json()).school.logo).toBeNull();
  expect((await get(`/api/schools/${slug}/logo`)).status).toBe(404);
  expect(await (await get(`/s/${slug}`)).text()).toContain('og:image" content="https://aem.example/og-default.png"');
  // Another school's logo is never served under this slug.
  expect((await get(`/api/schools/${otherSlug}/logo`)).status).toBe(404);
  const actions = (await owner.query("select action from school_app.audit_log where school_id=$1 and action like '%LOGO'", [school])).rows.map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(["SET_LOGO", "CLEAR_LOGO"]));
});
