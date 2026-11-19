import { chromium } from "../frontend/node_modules/playwright/index.mjs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('[LOG]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[PAGE ERROR]', err.message));
  page.on('response', async res => {
    if (res.url().includes('/api/')) {
      const text = await res.text().catch(() => '');
      console.log(`[API ${Date.now()}]`, res.status(), res.url(), text.slice(0, 80));
    }
  });

  await page.goto('http://localhost:4200/s/la-marseillaise/connexion', { waitUntil: 'networkidle' });

  await page.fill('input[type="email"]', 'admin@lamarseillaise.cm');
  await page.fill('input[type="password"]', 'Admin@Marseillaise2026!');
  
  console.log(`[START] Clicking submit at ${Date.now()}...`);
  await page.click('form .actions button');
  
  // Wait up to 60 seconds for navigation
  await page.waitForFunction(() => !window.location.pathname.endsWith('/connexion'), { timeout: 60000 });

  console.log('Final URL after login:', page.url());
  console.log('Final Headings:', await page.locator('h1, h2').allInnerTexts().catch(() => []));

  await browser.close();
}

run().catch(console.error);
