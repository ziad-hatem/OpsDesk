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

  page.on('request', req => { if (req.url().includes('/api/')) console.log('REQ:', req.method(), req.url()); });

  const btn = page.locator('table tbody tr').first().locator('button').first();
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  console.log('URL:', page.url());
  console.log('dialog count:', await page.locator('[role="dialog"]').count());
  console.log('sheet/drawer count:', await page.locator('[data-slot="sheet-content"], [data-slot="drawer-content"]').count());
  await page.screenshot({ path: '_recon-after-ticket-click.png', fullPage: true });

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
