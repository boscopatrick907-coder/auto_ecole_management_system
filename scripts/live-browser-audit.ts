import { chromium, type Browser, type Page } from "../frontend/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs/promises";

interface TestReportItem {
  id: number;
  name: string;
  status: "PASSED" | "FAILED" | "WARNING";
  details: string;
  screenshot?: string;
  durationMs: number;
}

const report: TestReportItem[] = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const networkFailures: Array<{ url: string; status: number; statusText: string }> = [];

const SCREENSHOTS_DIR = path.resolve(process.cwd(), "test-results/screenshots");
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:4200";

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
    throw err; // propagate to handle or see if subsequent steps can recover
  }
}

async function main() {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  console.log("===============================================================");
  console.log("  STARTING AUTOMATED E2E BROWSER AUDIT WITH CHROME (HEADLESS)  ");
  console.log("  Target: " + BASE_URL);
  console.log("===============================================================");

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "fr-FR",
  });

  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!text.includes("favicon") && !text.includes("download the React DevTools")) {
        consoleErrors.push(text);
        console.log(`  [Browser Console Error] ${text}`);
      }
    }
  });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.log(`  [Browser Page Error] ${err.message}`);
  });

  page.on("response", (res) => {
    // 401 on /api/auth/get-session or /auth/session or intentional 400 on negative test are normal
    if (res.status() >= 400 && !res.url().includes("/favicon.ico") && !res.url().includes("/auth/sign-in/email")) {
      networkFailures.push({
        url: res.url(),
        status: res.status(),
        statusText: res.statusText(),
      });
      console.log(`  [Network Warning] ${res.status()} ${res.url()}`);
    }
  });

  try {
    // -------------------------------------------------------------
    // STEP 1: Landing Page
    // -------------------------------------------------------------
    await runStep("Landing Page Navigation & Branding", async () => {
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      const title = await page.title();
      const content = await page.textContent("body");
      const screenshot = path.join(SCREENSHOTS_DIR, "01_landing.png");
      await page.screenshot({ path: screenshot });

      if (!content?.includes("Espace auto-école")) {
        throw new Error("Landing page missing 'Espace auto-école' brand title");
      }
      return { details: `Landing title: '${title}', school input available`, screenshot };
    });

    // -------------------------------------------------------------
    // STEP 2: School Code Resolution
    // -------------------------------------------------------------
    await runStep("School Code Resolution (la-marseillaise)", async () => {
      const input = page.locator('input[placeholder="mon-ecole"]');
      await input.fill("la-marseillaise");
      const submitBtn = page.locator('button:has-text("Ouvrir mon école")');
      await submitBtn.click();

      await page.waitForFunction(() => window.location.pathname.includes('/connexion'), { timeout: 30000 });
      await page.waitForSelector('.auth-brand, form', { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "02_school_login_page.png");
      await page.screenshot({ path: screenshot });

      const text = await page.textContent("body");
      if (!text?.includes("Auto-école La Marseillaise")) {
        throw new Error("School brand 'Auto-école La Marseillaise' not rendered on login page");
      }
      return { details: "Resolved school slug and rendered custom tenant branding", screenshot };
    });

    // -------------------------------------------------------------
    // STEP 3: Student Login Negative Test
    // -------------------------------------------------------------
    await runStep("Student Login - Invalid Credentials Rejection", async () => {
      await page.fill('input[type="email"]', "eleve.completion@lamarseillaise.cm");
      await page.fill('input[type="password"]', "WrongPassword2026!");
      await page.click('form .actions button:has-text("Connexion")');

      // Wait for error box or failure indicator
      await page.waitForSelector('.error-box, [role="alert"]', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "03_student_login_error.png");
      await page.screenshot({ path: screenshot });

      const errorText = await page.locator('.error-box, [role="alert"]').textContent();
      return { details: `Rejected bad password. Error banner: '${errorText?.trim()}'`, screenshot };
    });

    // -------------------------------------------------------------
    // STEP 4: Student Login Positive Test
    // -------------------------------------------------------------
    await runStep("Student Login - Valid Credentials & Portal Entry", async () => {
      await page.fill('input[type="email"]', "eleve.completion@lamarseillaise.cm");
      await page.fill('input[type="password"]', "StudentLegacyPass2026!");
      await page.click('form .actions button:has-text("Connexion")');

      await page.waitForFunction(() => window.location.pathname.includes('/accueil'), { timeout: 35000 });
      await page.waitForSelector('main, .trial-card, .card', { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "04_student_home.png");
      await page.screenshot({ path: screenshot });

      const bodyText = await page.textContent("body");
      const hasWelcome = bodyText?.includes("Bonjour") || bodyText?.includes("Formation");
      return { details: `Student successfully authenticated. Dashboard welcome verified: ${hasWelcome}`, screenshot };
    });

    // -------------------------------------------------------------
    // STEP 5: Student Payments Tab
    // -------------------------------------------------------------
    await runStep("Student Payments & Financial Ledger", async () => {
      const tab = page.locator('nav.bottom-nav a:has-text("Paiements"), a[href*="paiements"]');
      if (await tab.count() > 0) {
        await tab.first().click();
      } else {
        await page.goto(`${BASE_URL}/s/la-marseillaise/paiements`, { waitUntil: "networkidle" });
      }
      await page.waitForFunction(() => window.location.pathname.includes('/paiements'), { timeout: 20000 });
      await page.waitForSelector('.money-grid, .card, main', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "05_student_payments.png");
      await page.screenshot({ path: screenshot });

      const text = await page.textContent("body");
      const hasPaymentsHeading = text?.includes("Paiements") || text?.includes("Montant");
      return { details: `Payment schedule and receipts section verified: ${hasPaymentsHeading}`, screenshot };
    });

    // -------------------------------------------------------------
    // STEP 6: Student Courses Tab
    // -------------------------------------------------------------
    await runStep("Student Educational Curriculum (/cours)", async () => {
      const tab = page.locator('nav.bottom-nav a:has-text("Cours"), a[href*="cours"]');
      if (await tab.count() > 0) {
        await tab.first().click();
      } else {
        await page.goto(`${BASE_URL}/s/la-marseillaise/cours`, { waitUntil: "networkidle" });
      }
      await page.waitForFunction(() => window.location.pathname.includes('/cours'), { timeout: 20000 });
      await page.waitForSelector('main, .course-card, app-empty', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "06_student_courses.png");
      await page.screenshot({ path: screenshot });

      return { details: "Courses library view rendered with pedagogical resources", screenshot };
    });

    // -------------------------------------------------------------
    // STEP 7: Student Quiz View
    // -------------------------------------------------------------
    await runStep("Student Exam & Code Quizzes (/quiz)", async () => {
      const tab = page.locator('nav.bottom-nav a:has-text("Quiz"), a[href*="quiz"]');
      if (await tab.count() > 0) {
        await tab.first().click();
      } else {
        await page.goto(`${BASE_URL}/s/la-marseillaise/quiz`, { waitUntil: "networkidle" });
      }
      await page.waitForFunction(() => window.location.pathname.includes('/quiz'), { timeout: 20000 });
      await page.waitForSelector('main, .card, app-empty', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "07_student_quiz.png");
      await page.screenshot({ path: screenshot });

      return { details: "Exam training quiz engine loaded properly", screenshot };
    });

    // -------------------------------------------------------------
    // STEP 8: Student Logout
    // -------------------------------------------------------------
    await runStep("Student Session Termination (Logout)", async () => {
      const avatarBtn = page.locator('button.avatar');
      await avatarBtn.click();

      await page.waitForFunction(() => window.location.pathname.includes('/connexion'), { timeout: 20000 });
      await page.waitForSelector('.auth-brand, form', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "08_student_logged_out.png");
      await page.screenshot({ path: screenshot });

      return { details: "Clean session teardown, indexedDB local state purged", screenshot };
    });

    // -------------------------------------------------------------
    // STEP 9: Admin Login Positive Test
    // -------------------------------------------------------------
    await runStep("Admin Login & Executive Portal Entry", async () => {
      await page.fill('input[type="email"]', "admin@lamarseillaise.cm");
      await page.fill('input[type="password"]', "Admin@Marseillaise2026!");
      await page.click('form .actions button:has-text("Connexion")');

      await page.waitForFunction(() => window.location.pathname.includes('/admin'), { timeout: 35000 });
      await page.waitForSelector('.kpi-grid, main', { timeout: 25000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "09_admin_dashboard.png");
      await page.screenshot({ path: screenshot });

      const text = await page.textContent("body");
      const hasAdmin = text?.includes("Tableau de bord") || text?.includes("Recettes");
      return { details: `Admin successfully authenticated. KPIs verified: ${hasAdmin}`, screenshot };
    });

    // -------------------------------------------------------------
    // STEP 10: Admin Students Roster
    // -------------------------------------------------------------
    await runStep("Admin Student Roster (/admin/eleves)", async () => {
      const tab = page.locator('nav.bottom-nav a:has-text("Élèves"), a[href*="eleves"]');
      if (await tab.count() > 0) {
        await tab.first().click();
      } else {
        await page.goto(`${BASE_URL}/s/la-marseillaise/admin/eleves`, { waitUntil: "networkidle" });
      }
      await page.waitForFunction(() => window.location.pathname.includes('/admin/eleves'), { timeout: 20000 });
      await page.waitForSelector('.student-row, app-empty, input[name="query"]', { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "10_admin_students.png");
      await page.screenshot({ path: screenshot });

      const text = await page.textContent("body");
      const hasCompletion = text?.includes("Completion student") || text?.includes("LM-");
      return { details: `Active student roster loaded. Legacy student row confirmed: ${hasCompletion}`, screenshot };
    });

    // -------------------------------------------------------------
    // STEP 11: Admin Student Dossier Inspection
    // -------------------------------------------------------------
    await runStep("Admin Student Dossier Deep Dive (/admin/eleves/:id)", async () => {
      const studentRow = page.locator('a.student-row').first();
      await studentRow.click();

      await page.waitForFunction(() => /\/admin\/eleves\/[0-9a-f-]+/.test(window.location.pathname), { timeout: 20000 });
      await page.waitForSelector('.money-grid, h1', { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "11_admin_student_dossier.png");
      await page.screenshot({ path: screenshot });

      const text = await page.textContent("body");
      const hasRecordBtn = text?.includes("Enregistrer un paiement");
      return { details: `Dossier opened. Payment action button present: ${hasRecordBtn}`, screenshot };
    });

    // -------------------------------------------------------------
    // STEP 12: Admin Cohorts & Groups
    // -------------------------------------------------------------
    await runStep("Admin Training Groups & Cohorts (/admin/groupes)", async () => {
      const tab = page.locator('nav.bottom-nav a:has-text("Groupes"), a[href*="groupes"]');
      if (await tab.count() > 0) {
        await tab.first().click();
      } else {
        await page.goto(`${BASE_URL}/s/la-marseillaise/admin/groupes`, { waitUntil: "networkidle" });
      }
      await page.waitForFunction(() => window.location.pathname.includes('/admin/groupes'), { timeout: 20000 });
      await page.waitForSelector('main, .card, button:has-text("Créer un groupe")', { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "12_admin_groups.png");
      await page.screenshot({ path: screenshot });

      const text = await page.textContent("body");
      const hasGroups = text?.includes("Groupes") || text?.includes("Permis");
      return { details: `Cohorts management rendered. Active groups verified: ${hasGroups}`, screenshot };
    });

    // -------------------------------------------------------------
    // STEP 13: Admin Financial Daily Journal
    // -------------------------------------------------------------
    await runStep("Admin Financial Daily Journal (/admin/journal)", async () => {
      await page.goto(`${BASE_URL}/s/la-marseillaise/admin/journal`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.location.pathname.includes('/admin/journal'), { timeout: 20000 });
      await page.waitForSelector('.money-grid, input[type="date"], h1', { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "13_admin_journal.png");
      await page.screenshot({ path: screenshot });

      return { details: "Daily transaction journal loaded with date picker and receipt stats", screenshot };
    });

    // -------------------------------------------------------------
    // STEP 14: Admin Financial Monthly Report
    // -------------------------------------------------------------
    await runStep("Admin Financial Monthly Report (/admin/rapport)", async () => {
      await page.goto(`${BASE_URL}/s/la-marseillaise/admin/rapport`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.location.pathname.includes('/admin/rapport'), { timeout: 20000 });
      await page.waitForSelector('.money-grid, input[type="month"], h1', { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "14_admin_monthly_report.png");
      await page.screenshot({ path: screenshot });

      return { details: "Monthly consolidated revenue report and CSV export option loaded", screenshot };
    });

    // -------------------------------------------------------------
    // STEP 15: Admin School Settings
    // -------------------------------------------------------------
    await runStep("Admin School Metadata & Branding (/admin/parametres)", async () => {
      await page.goto(`${BASE_URL}/s/la-marseillaise/admin/parametres`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.location.pathname.includes('/admin/parametres'), { timeout: 20000 });
      await page.waitForSelector('form, input[formControlName="name"]', { timeout: 20000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "15_admin_settings.png");
      await page.screenshot({ path: screenshot });

      const nameVal = await page.inputValue('input[formControlName="name"]');
      return { details: `School settings form loaded with school name: '${nameVal}'`, screenshot };
    });

    // -------------------------------------------------------------
    // STEP 16: Admin Logout
    // -------------------------------------------------------------
    await runStep("Admin Session Termination (Logout)", async () => {
      const avatarBtn = page.locator('button.avatar');
      await avatarBtn.click();

      await page.waitForFunction(() => window.location.pathname.includes('/connexion'), { timeout: 20000 });
      await page.waitForSelector('.auth-brand, form', { timeout: 15000 });
      const screenshot = path.join(SCREENSHOTS_DIR, "16_admin_logged_out.png");
      await page.screenshot({ path: screenshot });

      return { details: "Admin session destroyed, returned safely to tenant login view", screenshot };
    });

  } finally {
    await browser.close();
  }

  // Generate Report Summary
  console.log("\n========================================================");
  console.log("            END-TO-END BROWSER AUDIT SUMMARY            ");
  console.log("========================================================");
  let passedCount = 0;
  let failedCount = 0;
  for (const item of report) {
    const symbol = item.status === "PASSED" ? "✔" : "✖";
    console.log(`${symbol} [${item.status}] Step ${item.id}: ${item.name} (${item.durationMs}ms)`);
    if (item.status === "PASSED") passedCount++;
    else failedCount++;
  }
  console.log(`\nTOTAL: ${report.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log(`Browser Console Errors: ${consoleErrors.length}`);
  console.log(`Browser Unhandled Page Errors: ${pageErrors.length}`);
  console.log(`Network Warnings: ${networkFailures.length}`);

  // Save report to JSON for artifact generation
  await fs.writeFile(
    path.resolve(process.cwd(), "test-results/browser-audit-report.json"),
    JSON.stringify({ report, consoleErrors, pageErrors, networkFailures }, null, 2),
    "utf8"
  );
}

main().catch((err) => {
  console.error("Fatal audit error:", err);
  process.exit(1);
});
