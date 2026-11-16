import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import path from "node:path";

async function debug() {
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const context = await browser.newContext({ locale: "fr-FR" });
  const page = await context.newPage();

  page.on("console", (msg) => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => console.log(`[Browser PageError] ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 400) console.log(`[HTTP ${res.status()}] ${res.url()}`);
  });

  console.log("Navigating to login...");
  await page.goto("http://localhost:4200/s/la-marseillaise/connexion", { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@lamarseillaise.cm");
  await page.fill('input[type="password"]', "Admin@Marseillaise2026!");
  await page.click('form .actions button:has-text("Connexion")');

  await page.waitForFunction(() => window.location.pathname.includes('/admin'), { timeout: 30000 });
  console.log("Logged in. Current URL:", page.url());

  console.log("Navigating to /admin/eleves via click...");
  const tab = page.locator('nav.bottom-nav a:has-text("Élèves")');
  console.log("Tab count:", await tab.count());
  if (await tab.count() > 0) {
    await tab.first().click();
  } else {
    await page.goto("http://localhost:4200/s/la-marseillaise/admin/eleves");
  }

  await page.waitForTimeout(4000);
  console.log("After click/nav, Current URL:", page.url());
  await page.screenshot({ path: "test-results/screenshots/debug_admin_eleves.png" });

  const html = await page.innerHTML("main");
  console.log("HTML inside <main>:\n", html);

  await browser.close();
}

debug().catch(console.error);
