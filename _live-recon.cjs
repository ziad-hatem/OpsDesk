const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('https://ops-desk.ziadhatem.dev/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', 'test@test.com');
  await page.fill('input[type="password"], input[name="password"]', 'test123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => null),
    page.click('button:has-text("Sign In")'),
  ]);
  await page.waitForTimeout(2000);

  console.log('URL after login:', page.url());
  await page.screenshot({ path: '_recon-dashboard.png', fullPage: true });

  const links = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const hrefs = anchors.map(a => a.getAttribute('href')).filter(Boolean);
    return Array.from(new Set(hrefs));
  });
  console.log('LINKS:', JSON.stringify(links, null, 2));

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('BODY PREVIEW:', bodyText);

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
