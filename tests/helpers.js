// Shared helpers for the browser tests (Playwright + Chromium driving the real web app).
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const WWW = path.join(__dirname, '../app/src/main/assets/www');
const OUT = path.join(__dirname, 'out');
const MIME = { html: 'text/html', js: 'application/javascript', css: 'text/css', woff2: 'font/woff2', json: 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      const f = path.join(WWW, p);
      if (!f.startsWith(WWW) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[f.split('.').pop()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + srv.address().port + '/', close: () => srv.close() }));
  });
}

async function open(browser, url, viewport, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport, deviceScaleFactor: 1, acceptDownloads: true }, opts || {}));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('.authcard, .shell');
  return page;
}

/** Types a number into the on-screen keypad that is currently open, then presses Done. */
async function pad(page, value) {
  const m = page.locator('.modal').last();
  await m.getByRole('button', { name: 'Clear' }).click();
  for (const ch of String(value)) await m.locator(`.key[data-key="${ch}"]`).click();
  await m.getByRole('button', { name: 'Done' }).click();
}
/** Sets a keypad-backed number field of the open form. */
async function num(page, key, value) { await page.locator(`.modal [data-field="${key}"]`).last().click(); await pad(page, value); }
async function text(page, key, value) { await page.locator(`.modal [data-field="${key}"]`).last().fill(String(value)); }
async function choose(page, key, label) { await page.locator(`.modal select[data-field="${key}"]`).last().selectOption({ label }); }
async function submit(page, label) { await page.locator('.modal').last().locator('.mfoot').getByRole('button', { name: label || 'Save', exact: true }).click(); }
async function nav(page, id) { await page.locator(`.rail [data-nav="${id}"], .bottomnav [data-nav="${id}"]`).locator('visible=true').first().click(); }
async function toastGone(page) { await page.waitForTimeout(150); }

async function setup(page, o) {
  o = o || {};
  await page.fill('[data-field="station"]', o.station || 'Santos Fuel Station');
  await page.fill('[data-field="name"]', o.name || 'Juan Santos');
  await page.fill('[data-field="username"]', o.username || 'juan');
  await page.fill('[data-field="password"]', o.password || 'secret123');
  await page.fill('[data-field="password2"]', o.password || 'secret123');
  await page.getByRole('button', { name: 'Create Owner account' }).click();
  await page.waitForSelector('.shell');
}
async function login(page, username, password) {
  await page.fill('[data-field="username"]', username);
  await page.fill('[data-field="password"]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function logout(page) {
  await page.locator('.userchip').click();
  await page.locator('[data-act="signout"]').click();
  await page.waitForSelector('.authcard');
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}
function eq(name, actual, expected) { check(name, actual === expected, { actual, expected }); }
function near(name, actual, expected, tol) { check(name, Math.abs(actual - expected) <= (tol || 0.005), { actual, expected }); }

module.exports = { chromium, serve, open, pad, num, text, choose, submit, nav, setup, login, logout, toastGone, check, eq, near, OUT, WWW, failures: () => failures };
