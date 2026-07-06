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

  const pagesToCheck = ['/tickets', '/orders', '/customers', '/incidents', '/reports', '/calendar', '/settings', '/settings/team', '/account'];
  for (const p of pagesToCheck) {
    try {
      await page.goto('https://ops-desk.ziadhatem.dev' + p, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
      const links = await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(Boolean))));
      const rowLinkSample = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table a[href], [role="row"] a[href]'));
        return rows.slice(0,3).map(a => a.getAttribute('href'));
      });
      console.log('=== ' + p + ' (final url: ' + page.url() + ') ===');
      console.log('links:', JSON.stringify(links));
      console.log('rowLinkSample:', JSON.stringify(rowLinkSample));
    } catch (e) {
      console.log('=== ' + p + ' ERROR ===', e.message);
    }
  }

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
