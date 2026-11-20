import { chromium, type Browser, type Page } from "../frontend/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs/promises";
// Read when used, after any .env / .dev.vars loading. Never hardcode a real password.
function adminPassword(): string {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) throw new Error("Set ADMIN_PASSWORD to the admin account's password before running this script.");
  return value;
}

interface TestReportItem {
  id: number;
  name: string;
  status: "PASSED" | "FAILED";
  details: string;
  screenshot?: string;
  durationMs: number;
}

const report: TestReportItem[] = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const networkFailures: Array<{ url: string; status: number; statusText: string }> = [];

const SCREENSHOTS_DIR = path.resolve(process.cwd(), "test-results/devtunnels-screenshots");
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FRONTEND_URL = "https://5xwdcmgv-4200.use.devtunnels.ms";
const BACKEND_URL = "https://5xwdcmgv-8788.use.devtunnels.ms";

let stepIdCounter = 1;

async function runStep(
  name: string,
  fn: () => Promise<{ details: string; screenshot?: string }>
) {
  const currentId = stepIdCounter++;
  const start = Date.now();
  console.log(`\n▶ [STEP ${currentId}] START: ${name}...`);
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    console.log(`✔ [PASS] Step ${currentId}: ${name} (${durationMs}ms) - ${result.details}`);
    report.push({
      id: currentId,
      name,
      status: "PASSED",
      details: result.details,
      screenshot: result.screenshot,
      durationMs,
    });
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error(`✖ [FAIL] Step ${currentId}: ${name} (${durationMs}ms):`, err.message);
    report.push({
      id: currentId,
      name,
      status: "FAILED",
      details: err.message,
      durationMs,
    });
  }
}

async function bypassTunnelProtectionIfNeeded(page: Page) {
  try {
    const continueBtn = page.locator('#continue');
    if (await continueBtn.isVisible({ timeout: 2000 })) {
      console.log("  ↳ Microsoft Dev Tunnel interstitial detected. Clicking Continue...");
      await continueBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch {
    // No interstitial present, continue normally
  }
}

async function main() {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  console.log("===============================================================");
  console.log("  TESTING DEV TUNNELS FOR AUTO-ECOLE PLATFORM                 ");
  console.log("  Frontend: " + FRONTEND_URL);
  console.log("  Backend:  " + BACKEND_URL);
  console.log("===============================================================");

  // 1. Direct Backend HTTP Health & Config Checks
  await runStep("Backend Dev Tunnel - /api/health", async () => {
    const res = await fetch(`${BACKEND_URL}/api/health`, {
      headers: { "X-Tunnel-Skip-Anti-Phishing-Page": "true" }
    });
    const json = await res.json() as any;
    if (!res.ok || !json.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
    return { details: `HTTP 200 OK: ${JSON.stringify(json)}` };
  });

  await runStep("Backend Dev Tunnel - /api/config", async () => {
    const res = await fetch(`${BACKEND_URL}/api/config`, {
      headers: { "X-Tunnel-Skip-Anti-Phishing-Page": "true" }
    });
    const json = await res.json() as any;
    if (!res.ok || json.contractVersion !== "2026-11-10.v1") {
      throw new Error(`Config contract version mismatch or error: HTTP ${res.status}`);
    }
    return { details: `HTTP 200 OK: contractVersion=${json.contractVersion}, turnstileSiteKey=${json.turnstileSiteKey}` };
  });

  await runStep("Backend Dev Tunnel - /api/schools/la-marseillaise/catalogue", async () => {
    const res = await fetch(`${BACKEND_URL}/api/schools/la-marseillaise/catalogue`, {
      headers: { "X-Tunnel-Skip-Anti-Phishing-Page": "true" }
    });
    const json = await res.json() as any;
    if (!res.ok || !json.school?.name) throw new Error(`Catalogue failed: HTTP ${res.status}`);
    return { details: `HTTP 200 OK: School '${json.school.name}', Categories: ${json.categories.length}, Groups: ${json.groups.length}` };
  });

  // 2. Headless Chrome Browser Testing
  const browser: Browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        "X-Tunnel-Skip-Anti-Phishing-Page": "true"
      }
    });

    const page: Page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    page.on("response", (res) => {
      if (res.status() >= 400) {
        networkFailures.push({
          url: res.url(),
          status: res.status(),
          statusText: res.statusText(),
        });
      }
    });

    // STEP 4: Frontend Dev Tunnel Landing Page
    await runStep("Frontend Dev Tunnel - Landing Page", async () => {
      await page.goto(FRONTEND_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
      await bypassTunnelProtectionIfNeeded(page);
      await page.waitForSelector('input, button', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "01_frontend_landing.png");
      await page.screenshot({ path: screenshot });
      const title = await page.title();
      return { details: `Landing loaded, Title: '${title}'`, screenshot };
    });

    // STEP 5: School Resolution via UI Form
    await runStep("UI Navigation - School Code Entry (la-marseillaise)", async () => {
      const input = page.locator('input[placeholder="mon-ecole"], input');
      await input.fill("la-marseillaise");
      const submitBtn = page.getByRole("button", { name: /Ouvrir mon école|arrow_forward/i });
      await submitBtn.click();

      await page.waitForFunction(() => window.location.pathname.includes('/s/la-marseillaise'), { timeout: 20000 });
      await page.waitForSelector('text="Auto-école La Marseillaise"', { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "02_school_resolved.png");
      await page.screenshot({ path: screenshot });

      return { details: "Resolved school tenant 'la-marseillaise' with custom branding and active catalog", screenshot };
    });

    // STEP 6: Student Login
    await runStep("Student Authentication via Dev Tunnel", async () => {
      const emailInput = page.locator('input[type="email"], input[formControlName="email"], input[placeholder*="@"]');
      const passwordInput = page.locator('input[type="password"], input[formControlName="password"]');

      await emailInput.fill("eleve.completion@lamarseillaise.cm");
      await passwordInput.fill("StudentLegacyPass2026!");

      const loginBtn = page.getByRole("button", { name: /Connexion/i });
      await loginBtn.click();

      // Wait for student navigation to /accueil or student page
      await page.waitForFunction(() => window.location.pathname.includes('/accueil'), { timeout: 30000 });
      await page.waitForSelector('.topbar, app-bottom-nav, main', { timeout: 15000 });

      const screenshot = path.join(SCREENSHOTS_DIR, "03_student_home.png");
      await page.screenshot({ path: screenshot });
      return { details: "Student authenticated and entered student portal (/accueil)", screenshot };
    });

    // STEP 7: Student Payments Tab
    await runStep("Student Payments View (/paiements)", async () => {
      await page.goto(`${FRONTEND_URL}/s/la-marseillaise/paiements`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector('main', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "04_student_payments.png");
      await page.screenshot({ path: screenshot });
      return { details: "Student payments view loaded successfully", screenshot };
    });

    // STEP 8: Student Logout
    await runStep("Student Sign-out via Dev Tunnel", async () => {
      const avatarBtn = page.locator('button.avatar');
      await avatarBtn.click();

      await page.waitForFunction(() => window.location.pathname.includes('/connexion'), { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "05_student_signed_out.png");
      await page.screenshot({ path: screenshot });
      return { details: "Student signed out cleanly", screenshot };
    });

    // STEP 9: Admin Login
    await runStep("Admin Authentication via Dev Tunnel", async () => {
      const emailInput = page.locator('input[type="email"], input[formControlName="email"], input[placeholder*="@"]');
      const passwordInput = page.locator('input[type="password"], input[formControlName="password"]');

      await emailInput.fill("admin@lamarseillaise.cm");
      await passwordInput.fill(adminPassword());

      const loginBtn = page.getByRole("button", { name: /Connexion/i });
      await loginBtn.click();

      await page.waitForFunction(() => window.location.pathname.includes('/admin'), { timeout: 30000 });
      await page.waitForSelector('main', { timeout: 15000 });

      const screenshot = path.join(SCREENSHOTS_DIR, "06_admin_dashboard.png");
      await page.screenshot({ path: screenshot });
      return { details: "Admin authenticated and entered admin dashboard (/admin)", screenshot };
    });

    // STEP 10: Admin Students List
    await runStep("Admin Students Roster (/admin/eleves)", async () => {
      await page.goto(`${FRONTEND_URL}/s/la-marseillaise/admin/eleves`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector('main', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "07_admin_students.png");
      await page.screenshot({ path: screenshot });
      return { details: "Admin students roster loaded successfully", screenshot };
    });

    // STEP 11: Admin Groups
    await runStep("Admin Groups Roster (/admin/groupes)", async () => {
      await page.goto(`${FRONTEND_URL}/s/la-marseillaise/admin/groupes`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector('main', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "08_admin_groups.png");
      await page.screenshot({ path: screenshot });
      return { details: "Admin training groups roster loaded successfully", screenshot };
    });

  } finally {
    await browser.close();
  }

  // Save report to JSON
  await fs.writeFile(
    path.resolve(process.cwd(), "test-results/devtunnels-audit-report.json"),
    JSON.stringify({ report, consoleErrors, pageErrors, networkFailures }, null, 2),
    "utf8"
  );
  console.log("\nAudit report saved to test-results/devtunnels-audit-report.json");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
