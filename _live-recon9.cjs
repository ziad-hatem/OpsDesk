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
  await page.waitForTimeout(600);
  await page.getByText('Profile', { exact: true }).click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  console.log('URL after clicking Profile:', page.url());
  await page.screenshot({ path: '_recon-profile.png', fullPage: true });

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
