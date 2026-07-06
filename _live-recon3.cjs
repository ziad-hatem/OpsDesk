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

  async function clickFirstRowAndReport(listPath, rowSelectorCandidates) {
    await page.goto('https://ops-desk.ziadhatem.dev' + listPath, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    for (const sel of rowSelectorCandidates) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        await page.locator(sel).first().click();
        await page.waitForTimeout(1500);
        console.log(listPath, '-> clicked selector', sel, '-> url:', page.url());
        return;
      }
    }
    console.log(listPath, '-> no clickable row found among', JSON.stringify(rowSelectorCandidates));
  }

  await clickFirstRowAndReport('/tickets', ['table tbody tr', '[role="row"]']);
  await clickFirstRowAndReport('/orders', ['table tbody tr', '[role="row"]']);
  await clickFirstRowAndReport('/customers', ['table tbody tr', '[role="row"]']);
  await clickFirstRowAndReport('/incidents', ['table tbody tr', '[role="row"]']);

  // help link behavior
  await page.goto('https://ops-desk.ziadhatem.dev/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const helpHref = await page.locator('a:has-text("Help")').first().getAttribute('href').catch(() => null);
  const helpTarget = await page.locator('a:has-text("Help")').first().getAttribute('target').catch(() => null);
  console.log('Help link href:', helpHref, 'target:', helpTarget);

  // settings sub-pages sanity
  for (const p of ['/settings/sla', '/settings/roles', '/settings/automation', '/settings/activity']) {
    await page.goto('https://ops-desk.ziadhatem.dev' + p, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1200);
    const heading = await page.evaluate(() => document.querySelector('h1,h2')?.innerText || '(no h1/h2)');
    console.log(p, '-> heading:', heading);
  }

  // notifications bell
  await page.goto('https://ops-desk.ziadhatem.dev/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const bell = page.locator('button:has(svg)').filter({ hasText: '' });
  console.log('checking notif bell...');

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
