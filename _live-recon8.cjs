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

  await page.getByRole('button', { name: 'DA', exact: true }).click({ timeout: 5000 });
  await page.waitForTimeout(800);
  const items = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"], a[href]')).map(el => ({ text: el.innerText, href: el.getAttribute('href') })));
  console.log('DROPDOWN ITEMS:', JSON.stringify(items, null, 2));
  await page.screenshot({ path: '_recon-avatar-menu2.png' });

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
