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

  await page.goto('https://ops-desk.ziadhatem.dev/tickets', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const rowHtml = await page.evaluate(() => {
    const row = document.querySelector('table tbody tr');
    return row ? row.outerHTML.slice(0, 2000) : '(no row found)';
  });
  console.log('ROW HTML:', rowHtml);

  // try clicking the ticket id cell specifically
  const firstCell = page.locator('table tbody tr').first().locator('td').first();
  await firstCell.click({ timeout: 5000 }).catch(e => console.log('cell click failed', e.message));
  await page.waitForTimeout(1500);
  console.log('URL after clicking first cell:', page.url());
  const dialogVisible = await page.locator('[role="dialog"]').count();
  console.log('dialog count:', dialogVisible);

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
