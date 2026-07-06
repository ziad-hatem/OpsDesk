const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('https://ops-desk.ziadhatem.dev/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.fill('input[type="email"], input[name="email"]', 'test@test.com');
  await page.fill('input[type="password"], input[name="password"]', 'test123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
    page.click('button:has-text("Sign In")'),
  ]);
  await page.waitForTimeout(2000);

  const headerHtml = await page.evaluate(() => {
    const header = document.querySelector('header') || document.querySelector('nav');
    return header ? header.outerHTML.slice(-1500) : '(no header found)';
  });
  console.log('HEADER TAIL HTML:', headerHtml);

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
