import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import fs from "node:fs/promises";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import app from "../../src/tenant/worker.js";
import { type TenantBindings } from "../../src/tenant/context.js";
import { injectPage, schoolPathKind, sitemapXml, esc, previewImage } from "../../src/tenant/seo.js";

const url =
  process.env.TENANT_TEST_DATABASE_URL ||
  "postgresql://postgres:local_tenant_test@127.0.0.1:55436/postgres";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Disposable local database required");
const owner = new pg.Pool({ connectionString: url });
const listed = randomUUID(),
  hidden = randomUUID(),
  cat = randomUUID();
const listedSlug = "seo-listed-" + listed.slice(0, 8);
const hiddenSlug = "seo-hidden-" + hidden.slice(0, 8);
const INDEX = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Espace auto-école</title></head><body><app-root></app-root></body></html>`;
let assetFetches = 0;
const env: TenantBindings = {
  DATABASE_URL: url.replace(/\/\/[^@]*@/, "//api_tenant_login:api_local_only@"),
  AUTH_DATABASE_URL: url.replace(/\/\/[^@]*@/, "//api_identity_login:identity_local_only@"),
  BETTER_AUTH_URL: "http://localhost:8788",
  BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
  TRUSTED_ORIGINS: "http://localhost:4200",
  TURNSTILE_SECRET_KEY: "test-only",
  OFFLINE_PRIVATE_KEY_PEM: generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  ENVIRONMENT: "development",
  SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  R2_ACCOUNT_ID: "",
  R2_ACCESS_KEY_ID: "",
  R2_SECRET_ACCESS_KEY: "",
  R2_BUCKET_NAME: "",
  ASSETS: {
    fetch: async () => {
      assetFetches++;
      return new Response(INDEX, { headers: { "Content-Type": "text/html" } });
    },
  },
};
const get = (path: string) => app.request("https://aem.example" + path, {}, env);

beforeAll(async () => {
  await owner.query(await fs.readFile(new URL("../../migrations/001_multitenant.sql", import.meta.url), "utf8"));
  await owner.query(
    "do $$begin create role api_tenant_login login password 'api_local_only';exception when duplicate_object then null;end $$;grant aem_tenant_runtime to api_tenant_login;do $$begin create role api_identity_login login password 'identity_local_only';exception when duplicate_object then null;end $$;grant aem_identity_runtime to api_identity_login;",
  );
  // The listed school's name tries to inject markup; it must come out escaped.
  await owner.query(
    "insert into school_app.schools(id,name,slug,address,phone,listed) values($1,$2,$3,'Akwa, Douala','+237699000000',true),($4,'École privée',$5,'Yaoundé','',false)",
    [listed, `Étoile <script>alert(1)</script> "Sud"`, listedSlug, hidden, hiddenSlug],
  );
  await owner.query("insert into school_app.licence_categories(id,school_id,code,name) values($1,$2,'B','Permis B')", [cat, listed]);
  await owner.query(
    "insert into school_app.groups(school_id,licence_category_id,name,capacity,total_fee,schedule_text) values($1,$2,'Matin',20,150000,'Lun–Ven 8h'),($1,$2,'Soir',20,120000,'18h')",
    [listed, cat],
  );
}, 60000);
afterAll(async () => {
  await owner.end();
});

it("escapes values and keeps JSON-LD from closing its script tag", () => {
  expect(esc(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  const html = injectPage(
    INDEX,
    { title: "T<", description: "D", canonical: "https://x/", image: "https://x/i.png", noindex: true, jsonLd: { name: "</script><b>" } },
    "<p>body</p>",
  );
  expect(html).toContain("<title>T&lt;</title>");
  expect(html).toContain('<meta name="robots" content="noindex">');
  expect(html).toContain("<app-root><p>body</p></app-root>");
  expect(html).not.toContain("</script><b>");
  expect(previewImage("https://x", "javascript:alert(1)")).toBe("https://x/og-default.png");
});

it("classifies school paths into the public page, entry pages and private pages", () => {
  expect(schoolPathKind("")).toBe("home");
  expect(schoolPathKind("/")).toBe("home");
  for (const p of ["/connexion", "/activation", "/inscription", "/reinitialiser"]) expect(schoolPathKind(p)).toBe("entry");
  for (const p of ["/admin", "/admin/eleves/1", "/accueil", "/paiements", "/quiz/1"]) expect(schoolPathKind(p)).toBe("private");
  expect(sitemapXml("https://x", [{ slug: "a-b" }])).toContain("<loc>https://x/s/a-b</loc>");
});

it("public directory lists only active, opted-in schools with public fields", async () => {
  const r = await get("/api/schools");
  expect(r.status).toBe(200);
  const { schools } = await r.json();
  const slugs = schools.map((s: { slug: string }) => s.slug);
  expect(slugs).toContain(listedSlug);
  expect(slugs).not.toContain(hiddenSlug);
  expect(Object.keys(schools.find((s: { slug: string }) => s.slug === listedSlug)).sort()).toEqual(["address", "logo", "name", "slug"]);
});

it("home page is indexable and lists listed schools only", async () => {
  const r = await get("/");
  expect(r.status).toBe(200);
  const html = await r.text();
  expect(r.headers.get("X-Robots-Tag")).toBeNull();
  expect(html).toContain(`href="https://aem.example/s/${listedSlug}"`);
  expect(html).not.toContain(hiddenSlug);
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain('"@type":"WebSite"');
});

it("a listed school's page has its own title, preview, prices and DrivingSchool data", async () => {
  const r = await get(`/s/${listedSlug}`);
  expect(r.status).toBe(200);
  const html = await r.text();
  expect(html).toContain("<title>Étoile &lt;script&gt;alert(1)&lt;/script&gt; &quot;Sud&quot; — auto-école à Akwa, Douala</title>");
  expect(html).toContain(`<link rel="canonical" href="https://aem.example/s/${listedSlug}">`);
  expect(html).toContain('property="og:image" content="https://aem.example/og-default.png"');
  expect(html).toContain('"@type":"DrivingSchool"');
  expect(html).toContain("120 000 FCFA");
  expect(html).toContain("150 000 FCFA");
  expect(html).not.toContain('content="noindex"');
  expect(html).not.toContain("<script>alert(1)</script>");
});

it("login and activation pages preview the school but are never indexed", async () => {
  const r = await get(`/s/${listedSlug}/activation?code=ABCD-EFGH&tel=699000000`);
  const html = await r.text();
  expect(r.headers.get("X-Robots-Tag")).toBe("noindex");
  expect(html).toContain("<title>Connexion — Étoile");
  expect(html).not.toContain("ABCD-EFGH");
});

it("an unlisted school's page works by direct link but is not indexed", async () => {
  const r = await get(`/s/${hiddenSlug}`);
  expect(r.status).toBe(200);
  expect(r.headers.get("X-Robots-Tag")).toBe("noindex");
  expect(await r.text()).toContain("École privée");
});

it("private app pages are served unchanged, noindex, without touching the database", async () => {
  const before = assetFetches;
  const r = await get(`/s/${listedSlug}/admin/eleves`);
  expect(r.status).toBe(200);
  expect(r.headers.get("X-Robots-Tag")).toBe("noindex");
  expect(await r.text()).toBe(INDEX);
  expect(assetFetches).toBe(before + 1);
});

it("unknown schools get a 404 with noindex; robots and sitemap are served", async () => {
  const missing = await get("/s/does-not-exist-123");
  expect(missing.status).toBe(404);
  expect(missing.headers.get("X-Robots-Tag")).toBe("noindex");
  const robots = await (await get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /api/");
  expect(robots).toContain("Sitemap: https://aem.example/sitemap.xml");
  const sitemap = await (await get("/sitemap.xml")).text();
  expect(sitemap).toContain(`https://aem.example/s/${listedSlug}`);
  expect(sitemap).not.toContain(hiddenSlug);
});

it("without an ASSETS binding (API-only deploy) page routes are not served", async () => {
  const r = await app.request("https://aem.example/", {}, { ...env, ASSETS: undefined });
  expect(r.status).toBe(404);
});
