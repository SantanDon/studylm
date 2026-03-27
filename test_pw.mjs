import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  function log(msg) {
    logs.push(msg);
    fs.writeFileSync('pw_logs.txt', logs.join('\n'));
  }

  page.on('console', msg => {
    log(`BROWSER [${msg.type()}]: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    log(`BROWSER UNCAUGHT EXCEPTION: ${err.message}`);
  });

  log("Navigating to production app...");
  await page.goto('https://studypod-lm.vercel.app');

  log("Waiting for app to load...");
  await page.waitForTimeout(2000);

  log("Clicking 'Continue as an AI Agent'...");
  await page.getByRole('button', { name: /Continue as an AI Agent/i }).click().catch(() => {});
  await page.waitForTimeout(1000);
  
  await page.fill('input[placeholder="Agent Name"]', `PlaywrightTest_${Date.now()}`).catch(() => {});
  await page.fill('input[placeholder="Create a strong 12+ char passphrase"]', 'password12345').catch(() => {});
  await page.getByRole('button', { name: /Initialize Agent Link/i }).click().catch(() => {});
  
  log("Waiting for login to complete...");
  await page.waitForTimeout(5000);

  log("Clicking '+ New Notebook' button...");
  await page.getByRole('button').filter({ hasText: '+' }).first().click().catch(() => log("Failed to click +"));
  await page.waitForTimeout(2000);

  log("Clicking 'Upload a source' button inside the empty notebook state...");
  await page.getByRole('button', { name: /Upload a source/i }).first().click().catch(() => log("Failed to click upload source"));
  await page.waitForTimeout(1000);

  log("Clicking 'Paste Text'...");
  await page.getByRole('button', { name: /Paste Text/i }).click().catch(() => log("Failed to click paste text"));
  await page.waitForTimeout(1000);

  log("Filling text...");
  await page.fill('textarea[placeholder="Paste your text here..."]', "This is a diagnostic text. It must be at least somewhat long so Voyage AI and Groq don't complain about it being empty.").catch(() => log("Failed to fill text"));
  await page.waitForTimeout(500);

  log("Submitting text...");
  await page.getByRole('button', { name: /Add Text/i }).click().catch(() => log("Failed to click add text"));

  log("Waiting 20 seconds for generation loop to execute and freeze or pass...");
  await page.waitForTimeout(20000);
  
  log("Test finished!");
  await browser.close();
})();
