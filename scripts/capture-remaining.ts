import { chromium, type Browser } from "../frontend/node_modules/playwright/index.mjs";
import path from "node:path";
// Read when used, after any .env / .dev.vars loading. Never hardcode a real password.
function adminPassword(): string {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) throw new Error("Set ADMIN_PASSWORD to the admin account's password before running this script.");
  return value;
}

const SCREENSHOTS_DIR = "C:\\Users\\TOUTENUN\\.gemini\\antigravity\\brain\\551dc5e1-d3d5-4975-8c80-eb5cc4233d9b\\screenshots";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:4200";

async function main() {
  const browser: Browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  try {
    // -------------------------------------------------------------------------
    // 1. ADMIN FLOW: Students, Groups, Settings
    // -------------------------------------------------------------------------
    console.log("[Admin Flow] Logging in...");
    const adminContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const adminPage = await adminContext.newPage();
    adminPage.setDefaultTimeout(120000);

    await adminPage.goto(`${BASE_URL}/s/la-marseillaise/connexion`, { waitUntil: "domcontentloaded" });
    await adminPage.waitForSelector('input[type="email"]', { timeout: 30000 });
    await adminPage.fill('input[type="email"]', "admin@lamarseillaise.cm");
    await adminPage.fill('input[type="password"]', adminPassword());
    await adminPage.click('form .actions button');

    console.log("  Waiting for admin entry...");
    await adminPage.waitForFunction(() => window.location.pathname.includes('/admin'), { timeout: 120000 });
    await adminPage.waitForSelector('.kpi-grid, main', { timeout: 30000 });

    // Students tab
    console.log("  Navigating to Admin Students via tab click...");
    const studentsLink = adminPage.locator('a[href*="eleves"]').first();
    await studentsLink.click();
    await adminPage.waitForFunction(() => window.location.pathname.includes('/eleves'), { timeout: 30000 });
    await adminPage.waitForSelector('.student-row, input[name="query"], main', { timeout: 30000 });
    await adminPage.waitForTimeout(1000);
    await adminPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "04_desktop_admin_students.png") });
    console.log("✔ Saved 04_desktop_admin_students.png");

    // Groups tab
    console.log("  Navigating to Admin Groups via tab click...");
    const groupsLink = adminPage.locator('a[href*="groupes"]').first();
    await groupsLink.click();
    await adminPage.waitForFunction(() => window.location.pathname.includes('/groupes'), { timeout: 30000 });
    await adminPage.waitForSelector('main', { timeout: 30000 });
    await adminPage.waitForTimeout(1000);
    await adminPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "05_desktop_admin_groups.png") });
    console.log("✔ Saved 05_desktop_admin_groups.png");

    // Settings tab
    console.log("  Navigating to Admin Settings via tab click...");
    const settingsLink = adminPage.locator('a[href*="parametres"]').first();
    if (await settingsLink.count() > 0) {
      await settingsLink.click();
      await adminPage.waitForFunction(() => window.location.pathname.includes('/parametres'), { timeout: 30000 });
      await adminPage.waitForSelector('main', { timeout: 30000 });
      await adminPage.waitForTimeout(1000);
      await adminPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "06_desktop_admin_settings.png") });
      console.log("✔ Saved 06_desktop_admin_settings.png");
    }

    await adminContext.close();

    // -------------------------------------------------------------------------
    // 2. STUDENT FLOW (Mobile view: 390x844)
    // -------------------------------------------------------------------------
    console.log("\n[Student Flow] Logging in on mobile...");
    const studentContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const studentPage = await studentContext.newPage();
    studentPage.setDefaultTimeout(120000);

    await studentPage.goto(`${BASE_URL}/s/la-marseillaise/connexion`, { waitUntil: "domcontentloaded" });
    await studentPage.waitForSelector('input[type="email"]', { timeout: 30000 });
    await studentPage.fill('input[type="email"]', "eleve.completion@lamarseillaise.cm");
    await studentPage.fill('input[type="password"]', "StudentLegacyPass2026!");
    await studentPage.click('form .actions button');

    console.log("  Waiting for student entry...");
    await studentPage.waitForFunction(() => window.location.pathname.includes('/accueil'), { timeout: 120000 });
    await studentPage.waitForSelector('main, .card', { timeout: 30000 });
    await studentPage.waitForTimeout(1000);
    await studentPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "07_mobile_student_home.png") });
    console.log("✔ Saved 07_mobile_student_home.png");

    // Student Payments
    console.log("  Navigating to Payments...");
    const paymentsLink = studentPage.locator('a[href*="paiements"]').first();
    await paymentsLink.click();
    await studentPage.waitForFunction(() => window.location.pathname.includes('/paiements'), { timeout: 30000 });
    await studentPage.waitForSelector('main', { timeout: 30000 });
    await studentPage.waitForTimeout(1000);
    await studentPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "08_mobile_student_payments.png") });
    console.log("✔ Saved 08_mobile_student_payments.png");

    // Student Courses
    console.log("  Navigating to Courses...");
    const coursesLink = studentPage.locator('a[href*="cours"]').first();
    await coursesLink.click();
    await studentPage.waitForFunction(() => window.location.pathname.includes('/cours'), { timeout: 30000 });
    await studentPage.waitForSelector('main', { timeout: 30000 });
    await studentPage.waitForTimeout(1000);
    await studentPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "09_mobile_student_courses.png") });
    console.log("✔ Saved 09_mobile_student_courses.png");

    // Student Quizzes
    console.log("  Navigating to Quizzes...");
    const quizLink = studentPage.locator('a[href*="quiz"]').first();
    await quizLink.click();
    await studentPage.waitForFunction(() => window.location.pathname.includes('/quiz'), { timeout: 30000 });
    await studentPage.waitForSelector('main', { timeout: 30000 });
    await studentPage.waitForTimeout(1000);
    await studentPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "10_mobile_student_quiz.png") });
    console.log("✔ Saved 10_mobile_student_quiz.png");

    await studentContext.close();
    console.log("\nAll screenshots captured successfully!");
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
