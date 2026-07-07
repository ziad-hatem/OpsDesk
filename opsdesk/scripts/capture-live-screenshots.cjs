const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = 'https://ops-desk.ziadhatem.dev';
const OUT = path.join(__dirname, 'opsdesk', 'screenshots', 'live');

const BREAKPOINTS = {
  desktop: { width: 1440, height: 900, label: 'desktop-1440' },
  tablet: { width: 767, height: 1024, label: 'tablet-767' },
  mobile: { width: 375, height: 812, label: 'mobile-375' },
};

const bpKey = process.argv[2];
const bp = BREAKPOINTS[bpKey];
if (!bp) {
  console.error('Usage: node _live-capture.cjs <desktop|tablet|mobile>');
  process.exit(1);
}

async function shoot(page, name, fullPage = true) {
  const file = path.join(OUT, `${name}-${bp.label}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log('saved', file);
}

async function settle(page, ms = 1500) {
  await page.waitForTimeout(ms);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: bp.width, height: bp.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  // 1. Logged-out login page
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await settle(page, 1500);
  await shoot(page, '01-login');

  // 2. Log in
  await page.fill('input[type="email"], input[name="email"]', 'test@test.com');
  await page.fill('input[type="password"], input[name="password"]', 'test123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
    page.click('button:has-text("Sign In")'),
  ]);
  await settle(page, 2500);

  // 3. Dashboard
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '02-dashboard');

  // 4. Notifications page (full navigated page, not an overlay dropdown)
  try {
    await page.locator('button:has(svg.lucide-bell), [aria-label*="otif" i]').first().click({ timeout: 5000 });
    await settle(page, 1500);
    await shoot(page, '03-notifications');
  } catch (e) {
    console.log('notifications skipped:', e.message);
  }

  // 5. Tickets list + detail (row's first cell is a <button>, not a plain row click)
  await page.goto(BASE + '/tickets', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '04-tickets-list');
  try {
    const btn = page.locator('table tbody tr').first().locator('button').first();
    if (await btn.count() > 0) {
      await btn.click({ timeout: 5000 });
      await settle(page, 1500);
      await shoot(page, '05-tickets-detail');
    } else {
      console.log('no ticket row button to click');
    }
  } catch (e) { console.log('ticket detail skipped:', e.message); }

  // 6. Orders list + detail
  await page.goto(BASE + '/orders', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '06-orders-list');
  try {
    const btn = page.locator('table tbody tr').first().locator('button').first();
    if (await btn.count() > 0) {
      await btn.click({ timeout: 5000 });
      await settle(page, 1500);
      await shoot(page, '07-orders-detail');
    } else {
      console.log('no order row button to click');
    }
  } catch (e) { console.log('order detail skipped:', e.message); }

  // 7. Customers list + detail
  await page.goto(BASE + '/customers', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '08-customers-list');
  try {
    const btn = page.locator('table tbody tr').first().locator('button').first();
    if (await btn.count() > 0) {
      await btn.click({ timeout: 5000 });
      await settle(page, 1500);
      await shoot(page, '09-customers-detail');
    } else {
      console.log('no customer row button to click');
    }
  } catch (e) { console.log('customer detail skipped:', e.message); }

  // 8. Incidents
  await page.goto(BASE + '/incidents', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '10-incidents');

  // 9. Public status page
  await page.goto(BASE + '/status/test-workspace', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '11-public-status-page');

  // 10. Reports
  await page.goto(BASE + '/reports', { waitUntil: 'domcontentloaded' });
  await settle(page, 2000);
  await shoot(page, '12-reports');

  // 11. Calendar
  await page.goto(BASE + '/calendar', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '13-calendar');

  // 12. Settings pages
  await page.goto(BASE + '/settings/team', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '14-settings-team');

  await page.goto(BASE + '/settings/roles', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '15-settings-roles');

  await page.goto(BASE + '/settings/sla', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '16-settings-sla');

  await page.goto(BASE + '/settings/automation', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '17-settings-automation');

  await page.goto(BASE + '/settings/activity', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '18-settings-activity');

  // 13. Account
  await page.goto(BASE + '/account/profile', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '19-account');

  // 14. Help
  await page.goto(BASE + '/help', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await shoot(page, '20-help');

  await browser.close();
  console.log('DONE with', bpKey);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
