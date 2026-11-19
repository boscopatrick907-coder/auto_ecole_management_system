import { chromium, type Browser } from "../frontend/node_modules/playwright/index.mjs";
import path from "node:path";
import fs from "node:fs/promises";

const SCREENSHOTS_DIR = "C:\\Users\\TOUTENUN\\.gemini\\antigravity\\brain\\551dc5e1-d3d5-4975-8c80-eb5cc4233d9b\\screenshots";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:4200";

async function main() {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  console.log("=============================================================");
  console.log("  CAPTURING LIVE APPLICATION SCREENSHOTS (DESKTOP & MOBILE) ");
  console.log("=============================================================");

  const browser: Browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  try {
    // -------------------------------------------------------------------------
    // 1. LANDING & LOGIN (Mobile view: 390x844)
    // -------------------------------------------------------------------------
    console.log("\n[1] Capturing Mobile Landing & Login...");
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();
    mobilePage.setDefaultTimeout(120000);

    await mobilePage.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
    await mobilePage.waitForSelector('form', { timeout: 30000 });
    await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, "01_mobile_landing.png") });
    console.log("✔ Saved 01_mobile_landing.png");

    await mobilePage.goto(`${BASE_URL}/s/la-marseillaise/connexion`, { waitUntil: "networkidle" });
    await mobilePage.waitForSelector('.auth-brand, form', { timeout: 30000 });
    await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, "02_mobile_login.png") });
    console.log("✔ Saved 02_mobile_login.png");

    await mobileContext.close();

    // -------------------------------------------------------------------------
    // 2. ADMIN SUITE (Desktop view: 1280x800)
    // -------------------------------------------------------------------------
    console.log("\n[2] Logging in as Admin on Desktop (1280x800)...");
    const adminContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const adminPage = await adminContext.newPage();
    adminPage.setDefaultTimeout(120000);

    adminPage.on('response', res => {
      if (res.url().includes('/api/')) {
        console.log(`  [API] ${res.status()} ${res.url().split('/api')[1]}`);
      }
    });

    await adminPage.goto(`${BASE_URL}/s/la-marseillaise/connexion`, { waitUntil: "networkidle" });
    await adminPage.waitForSelector('input[type="email"]', { timeout: 30000 });
    await adminPage.fill('input[type="email"]', "admin@lamarseillaise.cm");
    await adminPage.fill('input[type="password"]', "Admin@Marseillaise2026!");
    
    console.log("  Submitting admin credentials...");
    await adminPage.click('form .actions button');

    console.log("  Waiting for Admin Dashboard entry...");
    await adminPage.waitForFunction(() => window.location.pathname.includes('/admin'), { timeout: 120000 });
    await adminPage.waitForSelector('.kpi-grid, main', { timeout: 60000 });
    await adminPage.waitForTimeout(1500);
    await adminPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "03_desktop_admin_dashboard.png") });
    console.log("✔ Saved 03_desktop_admin_dashboard.png");

    // Admin Students Roster
    console.log("  Navigating to Admin Students...");
    await adminPage.goto(`${BASE_URL}/s/la-marseillaise/admin/eleves`, { waitUntil: "networkidle" });
    await adminPage.waitForSelector('.student-row, main', { timeout: 60000 });
    await adminPage.waitForTimeout(1500);
    await adminPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "04_desktop_admin_students.png") });
    console.log("✔ Saved 04_desktop_admin_students.png");

    // Admin Training Groups
    console.log("  Navigating to Admin Groups...");
    await adminPage.goto(`${BASE_URL}/s/la-marseillaise/admin/groupes`, { waitUntil: "networkidle" });
    await adminPage.waitForSelector('main', { timeout: 60000 });
    await adminPage.waitForTimeout(1500);
    await adminPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "05_desktop_admin_groups.png") });
    console.log("✔ Saved 05_desktop_admin_groups.png");

    // Admin Settings
    console.log("  Navigating to Admin Settings...");
    await adminPage.goto(`${BASE_URL}/s/la-marseillaise/admin/parametres`, { waitUntil: "networkidle" });
    await adminPage.waitForSelector('form, input[formControlName="name"]', { timeout: 60000 });
    await adminPage.waitForTimeout(1500);
    await adminPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "06_desktop_admin_settings.png") });
    console.log("✔ Saved 06_desktop_admin_settings.png");

    await adminContext.close();

    // -------------------------------------------------------------------------
    // 3. STUDENT SUITE (Mobile view: 390x844)
    // -------------------------------------------------------------------------
    console.log("\n[3] Logging in as Student on Mobile (390x844)...");
    const studentContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const studentPage = await studentContext.newPage();
    studentPage.setDefaultTimeout(120000);

    studentPage.on('response', res => {
      if (res.url().includes('/api/')) {
        console.log(`  [API] ${res.status()} ${res.url().split('/api')[1]}`);
      }
    });

    await studentPage.goto(`${BASE_URL}/s/la-marseillaise/connexion`, { waitUntil: "networkidle" });
    await studentPage.waitForSelector('input[type="email"]', { timeout: 30000 });
    await studentPage.fill('input[type="email"]', "eleve.completion@lamarseillaise.cm");
    await studentPage.fill('input[type="password"]', "StudentLegacyPass2026!");
    
    console.log("  Submitting student credentials...");
    await studentPage.click('form .actions button');

    console.log("  Waiting for Student Portal entry...");
    await studentPage.waitForFunction(() => window.location.pathname.includes('/accueil'), { timeout: 120000 });
    await studentPage.waitForSelector('main, .card', { timeout: 60000 });
    await studentPage.waitForTimeout(1500);
    await studentPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "07_mobile_student_home.png") });
    console.log("✔ Saved 07_mobile_student_home.png");

    // Student Payments
    console.log("  Navigating to Student Payments...");
    await studentPage.goto(`${BASE_URL}/s/la-marseillaise/paiements`, { waitUntil: "networkidle" });
    await studentPage.waitForSelector('main', { timeout: 60000 });
    await studentPage.waitForTimeout(1000);
    await studentPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "08_mobile_student_payments.png") });
    console.log("✔ Saved 08_mobile_student_payments.png");

    // Student Courses
    console.log("  Navigating to Student Courses...");
    await studentPage.goto(`${BASE_URL}/s/la-marseillaise/cours`, { waitUntil: "networkidle" });
    await studentPage.waitForSelector('main', { timeout: 60000 });
    await studentPage.waitForTimeout(1000);
    await studentPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "09_mobile_student_courses.png") });
    console.log("✔ Saved 09_mobile_student_courses.png");

    // Student Quizzes
    console.log("  Navigating to Student Quizzes...");
    await studentPage.goto(`${BASE_URL}/s/la-marseillaise/quiz`, { waitUntil: "networkidle" });
    await studentPage.waitForSelector('main', { timeout: 60000 });
    await studentPage.waitForTimeout(1000);
    await studentPage.screenshot({ path: path.join(SCREENSHOTS_DIR, "10_mobile_student_quiz.png") });
    console.log("✔ Saved 10_mobile_student_quiz.png");

    await studentContext.close();

    console.log("\n=============================================================");
    console.log("  ALL 10 SHOWCASE SCREENSHOTS SUCCESSFULLY CAPTURED!        ");
    console.log("=============================================================");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal capture error:", err);
  process.exit(1);
});
