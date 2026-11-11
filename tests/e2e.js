// End-to-end test: drives the real app in Chromium through the main owner and cashier flows
// and checks the numbers, permissions, exports and backup/restore.
//   NODE_PATH=$(npm root -g) node tests/e2e.js
const T = require('./helpers.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const out = (sel, page) => page.locator(sel).first().innerText();
const kpi = async (page, key) => (await page.locator(`[data-kpi="${key}"] b`).first().innerText()).trim();

(async () => {
  const srv = await T.serve();
  const browser = await T.chromium.launch();
  const page = await T.open(browser, srv.url, { width: 1280, height: 800 });
  const { num, text, choose, submit, nav, check, eq } = T;

  console.log('First run');
  await page.getByRole('button', { name: 'Create Owner account' }).click();
  check('setup validates empty form', (await page.locator('.formerr').innerText()).includes('station name'));
  await T.setup(page);
  eq('lands on Inventory with starter products', await page.locator('[data-product-card]').count(), 4);

  console.log('Products, delivery, weighted average cost');
  await page.locator('[data-product-card="Diesel"]').getByRole('button', { name: 'Edit' }).click();
  await num(page, 'price', 60); await num(page, 'cost', 50); await num(page, 'startingStock', 10000); await num(page, 'reorderLevel', 3000);
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  eq('starting stock shown', (await out('[data-product-card="Diesel"] [data-out="stock"]', page)).trim(), '10,000 L');
  await page.locator('[data-product-card="Diesel"]').getByRole('button', { name: 'Delivery' }).click();
  await submit(page);
  check('delivery requires quantity', (await page.locator('.modal .formerr').innerText()).includes('Quantity'));
  await num(page, 'qty', 5000); await num(page, 'unitCost', 53); await text(page, 'supplier', 'Petron Depot'); await text(page, 'drNumber', 'DR-1001');
  check('delivery preview shows new average cost', (await page.locator('.modal').innerText()).includes('51.0000'));
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  eq('stock after delivery', (await out('[data-product-card="Diesel"] [data-out="stock"]', page)).trim(), '15,000 L');
  check('weighted average cost (10000@50 + 5000@53 = 51)', (await out('[data-product-card="Diesel"] [data-out="cost"]', page)).includes('51.0000'));

  console.log('Sales');
  await nav(page, 'sell');
  await page.locator('[data-product="Unleaded 91"]').click();
  await page.locator('.entrycard .key[data-key="5"]').click();
  await page.locator('[data-act="save-sale"]').click();
  check('sale blocked when product has no price', (await page.locator('.toast').last().innerText()).includes('selling price'));
  await page.locator('[data-product="Diesel"]').click();
  await page.getByRole('button', { name: 'By peso amount' }).click();
  for (const k of '500') await page.locator(`.entrycard .key[data-key="${k}"]`).click();
  eq('by amount: litres', (await out('[data-out="qty"]', page)).trim(), '8.333 L');
  eq('by amount: total', (await out('[data-out="total"]', page)).trim(), '₱500.00');
  eq('by amount: gross profit shown before saving', (await out('[data-out="profit"]', page)).trim(), '₱75.02');
  await page.locator('[data-act="save-sale"]').click();
  await page.waitForFunction(() => DB.data.sales.length === 1);
  await page.getByRole('button', { name: 'By litres' }).click();
  for (const k of '10') await page.locator(`.entrycard .key[data-key="${k}"]`).click();
  await page.locator('[data-field="payment"] button[data-v="gcash"]').click();
  eq('by litres: total', (await out('[data-out="total"]', page)).trim(), '₱600.00');
  await page.locator('[data-act="save-sale"]').click();
  await page.waitForFunction(() => DB.data.sales.length === 2);
  await page.screenshot({ path: path.join(T.OUT, 'sell-tablet.png') });
  const saveBox = await page.locator('[data-act="save-sale"]').boundingBox();
  check('Save button is visible without scrolling on a 1280x800 tablet', saveBox && saveBox.y + saveBox.height <= 800, saveBox);

  console.log('Dashboard');
  await nav(page, 'dashboard');
  eq('total sales', await kpi(page, 'sales'), '₱1,100.00');
  eq('cost of goods sold', await kpi(page, 'cogs'), '₱934.98');
  eq('gross profit', await kpi(page, 'gross'), '₱165.02');
  eq('litres sold', await kpi(page, 'litres'), '18.333 L');
  eq('gross margin', await kpi(page, 'margin'), '15.0%');
  eq('stock value', await kpi(page, 'stockvalue'), '₱764,065.02');

  console.log('Expenses and net profit');
  await nav(page, 'expenses');
  await page.locator('[data-act="add-expense"]').click();
  await choose(page, 'categoryId', 'Electricity'); await num(page, 'amount', 100); await text(page, 'note', 'Meralco bill');
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  await nav(page, 'dashboard');
  eq('net profit = sales - COGS - overhead', (await page.locator('[data-kpi="net"] b.big').innerText()).trim(), '₱65.02');

  console.log('Stock adjustment');
  await nav(page, 'inventory');
  await page.locator('[data-product-card="Diesel"]').getByRole('button', { name: 'Adjust' }).click();
  await num(page, 'counted', 14900);
  check('dipstick hint shows the difference', (await page.locator('.modal').innerText()).includes('-81.667 L'));
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  eq('stock after dipstick reading', (await out('[data-product-card="Diesel"] [data-out="stock"]', page)).trim(), '14,900 L');

  console.log('Sale above stock warns');
  await page.locator('[data-product-card="Engine Oil 1L"]').getByRole('button', { name: 'Edit' }).click();
  await num(page, 'price', 350); await num(page, 'cost', 250); await num(page, 'startingStock', 5);
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  await nav(page, 'sell');
  await page.locator('[data-product="Engine Oil 1L"]').click();
  await page.locator('.entrycard .key[data-key="6"]').click();
  await page.locator('[data-act="save-sale"]').click();
  check('warning dialog when sale exceeds stock', (await page.locator('.modal').innerText()).includes('Record it anyway'));
  await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
  eq('cancelled sale was not saved', await page.evaluate(() => DB.data.sales.length), 2);

  console.log('Credit sale and customer account');
  await nav(page, 'customers');
  await page.locator('[data-act="add-customer"]').click();
  await text(page, 'name', 'ABC Trucking');
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  await nav(page, 'sell');
  await page.locator('[data-product="Diesel"]').click();
  for (const k of '20') await page.locator(`.entrycard .key[data-key="${k}"]`).click();
  await page.locator('[data-field="payment"] button[data-v="credit"]').click();
  await page.locator('.modal').getByText('ABC Trucking').click();
  await page.locator('[data-act="save-sale"]').click();
  await page.waitForFunction(() => DB.data.sales.length === 3);
  await nav(page, 'customers');
  check('customer owes the credit sale', (await page.locator('.view').innerText()).includes('₱1,200.00'));
  await page.getByText('ABC Trucking').click();
  await page.locator('.modal').getByRole('button', { name: 'Record payment' }).click();
  await num(page, 'amount', 500);
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  eq('balance after payment', (await out('[data-out="receivable"]', page)).trim(), 'Total owed to you: ₱700.00');

  console.log('Shift with meter readings and cash count');
  await nav(page, 'shifts');
  await page.locator('[data-act="start-shift"]').click();
  await num(page, 'openingCash', 1000);
  const ids = await page.evaluate(() => L.fuelProducts().map((p) => ({ id: p.id, name: p.name })));
  for (const p of ids) await num(page, 'm_' + p.id, p.name === 'Diesel' ? 5000 : 0);
  await submit(page, 'Start shift');
  await page.waitForSelector('.modal', { state: 'detached' });
  await nav(page, 'sell');
  await page.locator('[data-product="Diesel"]').click();
  for (const k of '10') await page.locator(`.entrycard .key[data-key="${k}"]`).click();
  await page.locator('[data-act="save-sale"]').click();
  await page.waitForFunction(() => DB.data.sales.length === 4);
  await nav(page, 'shifts');
  await page.locator('[data-act="close-shift"]').click();
  for (const p of ids) await num(page, 'm_' + p.id, p.name === 'Diesel' ? 5010 : 0);
  await num(page, 'actualCash', 1590);
  await submit(page, 'Close shift');
  await page.waitForSelector('[data-out="variance"]');
  eq('expected 1600 vs counted 1590 = short 10', (await out('[data-out="variance"]', page)).trim(), '-₱10.00');
  check('meter matches recorded litres', (await page.locator('.modal').innerText()).replace(/\s+/g, ' ').includes('Diesel 5,000 5,010 10 10 0'));
  await page.screenshot({ path: path.join(T.OUT, 'shift-detail.png') });
  await page.locator('.modal .mfoot').getByRole('button', { name: 'Close' }).click();

  console.log('Recurring monthly expense');
  await nav(page, 'expenses');
  await page.locator('.pill[data-v="recurring"]').click();
  await page.locator('[data-act="add-recurring"]').click();
  await choose(page, 'categoryId', 'Rent'); await num(page, 'amount', 20000); await text(page, 'note', 'Lot rental');
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.locator('.pill[data-v="list"]').click();
  eq('recurring expense posted automatically this month', (await out('[data-out="overhead"]', page)).trim(), '₱20,100.00');

  console.log('Price history: old sales keep their price and cost');
  await nav(page, 'inventory');
  await page.locator('[data-product-card="Diesel"]').getByRole('button', { name: 'Edit' }).click();
  await num(page, 'price', 65);
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  const first = await page.evaluate(() => { const s = DB.data.sales[0]; return [s.unitPrice, s.unitCost, s.total, L.product(s.productId).price, DB.data.priceHistory.filter((x) => x.productId === s.productId).length]; });
  check('first sale still at 60 / 51 after price change to 65', first[0] === 60 && first[1] === 51 && first[2] === 500 && first[3] === 65, first);
  check('price history has created, cost edit, delivery, price edit', first[4] >= 4, first[4]);

  console.log('Users and the Cashier role');
  await nav(page, 'settings');
  await page.locator('[data-act="add-user"]').click();
  await text(page, 'displayName', 'Maria Cruz'); await text(page, 'username', 'maria'); await text(page, 'pw', 'maria123'); await text(page, 'pw2', 'maria123');
  await submit(page, 'Add user');
  await page.waitForSelector('.modal', { state: 'detached' });
  const stored = await page.evaluate(() => { const u = DB.data.users[1]; return { hasPlain: JSON.stringify(u).includes('maria123'), hash: u.hash.length, salt: u.salt.length, iter: u.iter }; });
  check('password stored only as a salted PBKDF2 hash', !stored.hasPlain && stored.hash === 64 && stored.salt === 32 && stored.iter >= 60000, stored);
  await T.logout(page);
  await T.login(page, 'maria', 'wrong-pass');
  await page.waitForSelector('.formerr .banner');
  check('wrong password rejected', (await page.locator('.formerr').innerText()).includes('Wrong username or password'));
  await T.login(page, 'maria', 'maria123');
  await page.waitForSelector('.shell');
  eq('cashier has no Overview / Expenses / Reports / Credit', await page.locator('.rail [data-nav="dashboard"], .rail [data-nav="expenses"], .rail [data-nav="reports"], .rail [data-nav="customers"]').count(), 0);
  eq('cashier starts on Sell', (await page.locator('#title').innerText()).trim(), 'Sell');
  check('cashier does not see gross profit', !(await page.locator('.view').innerText()).includes('Gross profit'));
  await page.locator('[data-product="Diesel"]').click();
  await page.locator('.entrycard .key[data-key="5"]').click();
  await page.locator('[data-act="save-sale"]').click();
  await page.waitForFunction(() => DB.data.sales.length === 5);
  eq('sale records the user who made it', await page.evaluate(() => L.userName(DB.data.sales[4].userId)), 'Maria Cruz');
  eq('sale uses the new price', await page.evaluate(() => DB.data.sales[4].total), 325);
  await nav(page, 'transactions');
  eq('cashier sees only own sales', (await out('[data-out="count"]', page)).trim(), '1 entry');
  await page.locator('.view button.item').first().click();
  const detail = await page.locator('.modal').innerText();
  check('cashier detail has no cost, profit, edit or delete', !/Unit cost|Gross profit|Delete|Edit/.test(detail), detail);
  await page.locator('.modal .mfoot').getByRole('button', { name: 'Close' }).click();
  await nav(page, 'inventory');
  check('cashier cannot edit products or see cost', !/Edit|Cost|Add product/.test(await page.locator('.view').innerText()));
  await nav(page, 'settings');
  check('cashier settings has no Users / Backup', !/Users|Backup and restore|Audit/.test(await page.locator('.view').innerText()));
  await page.screenshot({ path: path.join(T.OUT, 'cashier-settings.png') });
  await T.logout(page);

  console.log('Owner: search, edit, delete, audit log');
  await T.login(page, 'juan', 'secret123');
  await page.waitForSelector('.shell');
  await nav(page, 'transactions');
  eq('all entries today', (await out('[data-out="count"]', page)).trim(), (new Date().getDate() === 1 ? 10 : 9) + ' entries');
  await page.locator('[data-filter="type"]').selectOption('sale');
  eq('filter by type', (await out('[data-out="count"]', page)).trim(), '5 entries');
  await page.locator('[data-filter="userId"]').selectOption({ label: 'Maria Cruz' });
  eq('filter by user', (await out('[data-out="count"]', page)).trim(), '1 entry');
  await page.locator('[data-filter="userId"]').selectOption('');
  await page.locator('[data-filter="productId"]').selectOption({ label: 'Engine Oil 1L' });
  eq('filter by product', (await out('[data-out="count"]', page)).trim(), '0 entries');
  await page.locator('[data-filter="productId"]').selectOption('');
  await page.locator('[data-filter="type"]').selectOption('');
  await page.locator('input[type="search"]').fill('petron');
  eq('search by supplier', (await out('[data-out="count"]', page)).trim(), '1 entry');
  await page.locator('input[type="search"]').fill('');
  await page.locator('[data-filter="preset"]').selectOption('yesterday');
  eq('filter by date', (await out('[data-out="count"]', page)).trim(), '0 entries');
  await page.locator('[data-filter="preset"]').selectOption('today');
  await page.screenshot({ path: path.join(T.OUT, 'transactions-tablet.png') });
  await page.locator('[data-filter="type"]').selectOption('expense');
  await page.getByText('Meralco bill').click();
  await page.locator('.modal').getByRole('button', { name: 'Delete' }).click();
  check('delete asks for confirmation', (await page.locator('.modal').last().innerText()).includes('cannot be undone'));
  await page.locator('.modal').last().getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction(() => DB.data.expenses.length === 1);
  await page.locator('[data-filter="type"]').selectOption('sale');
  await page.getByText('Diesel · 5 L').click();
  await page.locator('.modal').getByRole('button', { name: 'Edit' }).click();
  await num(page, 'qty', 6);
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  const edited = await page.evaluate(() => { const s = DB.data.sales[4]; return [s.qty, s.total, s.cogs]; });
  check('edited sale recalculated (6 L x 65 = 390)', edited[0] === 6 && edited[1] === 390 && edited[2] === 306, edited);
  const audit = await page.evaluate(() => DB.data.audit.map((a) => a.action + ':' + a.entity + ':' + L.userName(a.userId)));
  check('audit log has the delete and the edit, with user', audit.includes('delete:expense:Juan Santos') && audit.includes('edit:sale:Juan Santos'), audit);
  await nav(page, 'settings');
  await page.locator('[data-act="audit"]').click();
  check('audit log screen lists changes', /Deleted expense: Electricity/.test(await page.locator('.modal').innerText()));
  await page.screenshot({ path: path.join(T.OUT, 'audit-log.png') });
  await page.locator('.modal .iconbtn').first().click();

  console.log('Reports and exports');
  await page.locator('[data-act="edit-station"]').click();
  await text(page, 'address', '123 Rizal Ave, Parañaque City');
  await submit(page);
  await page.waitForSelector('.modal', { state: 'detached' });
  await nav(page, 'reports');
  const files = {};
  // Through the UI (download) for one report, and straight from the exporter for every report and format.
  for (const fmt of ['pdf', 'xlsx', 'csv']) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-export="${fmt}"]`).click()]);
    files['daily.' + fmt] = path.join(T.OUT, 'daily.' + fmt);
    await dl.saveAs(files['daily.' + fmt]);
  }
  for (const rep of ['pl', 'inventory', 'expenses', 'users', 'products']) {
    for (const fmt of ['pdf', 'xlsx', 'csv']) {
      const b64 = await page.evaluate(([rep, fmt]) => {
        const s = Settings.get(), from = U.monthStart(U.today()), to = U.today();
        const report = L.REPORTS.filter((r) => r.id === rep)[0].run(from, to);
        return U.base64(Exporter.make(report, fmt, { stationName: s.stationName, address: s.address, logo: s.logo, by: 'Juan Santos' }, from, to).bytes);
      }, [rep, fmt]);
      files[rep + '.' + fmt] = path.join(T.OUT, rep + '.' + fmt);
      fs.writeFileSync(files[rep + '.' + fmt], Buffer.from(b64, 'base64'));
    }
  }
  for (const k of Object.keys(files)) {
    if (k.endsWith('.pdf')) execFileSync('pdftotext', [files[k], '-']);
    if (k.endsWith('.xlsx')) execFileSync('python3', ['-c', 'import openpyxl,sys; openpyxl.load_workbook(sys.argv[1])', files[k]]);
  }
  check('all 6 reports export to PDF, Excel and CSV and every file opens', Object.keys(files).length === 18);
  await page.locator('.pill[data-v="pl"]').click();
  await page.screenshot({ path: path.join(T.OUT, 'reports-tablet.png') });
  const pdfText = execFileSync('pdftotext', ['-layout', files['daily.pdf'], '-']).toString();
  check('PDF: station, address with ñ, title and totals', /Santos Fuel Station/.test(pdfText) && /Parañaque/.test(pdfText) && /Daily sales/.test(pdfText) && /3,290\.00/.test(pdfText), pdfText.slice(0, 600));
  execFileSync('pdftoppm', ['-png', '-r', '80', files['pl.pdf'], path.join(T.OUT, 'pl-pdf')]);
  execFileSync('pdftoppm', ['-png', '-r', '80', files['daily.pdf'], path.join(T.OUT, 'daily-pdf')]);
  const xl = execFileSync('python3', ['-c', `
import openpyxl, sys, json
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.worksheets[0]
rows = [[c.value for c in r] for r in ws.iter_rows()]
print(json.dumps({'sheets': wb.sheetnames, 'rows': rows, 'fmt': ws.cell(row=len(rows), column=4).number_format}))`, files['daily.xlsx']]).toString();
  const x = JSON.parse(xl);
  check('Excel opens, has header + numeric totals', x.sheets.length === 1 && x.rows[x.rows.length - 1][0] === 'Total' && x.rows[x.rows.length - 1][3] === 3290 && x.fmt === '#,##0.00', x.rows.slice(-2));
  const x2 = JSON.parse(execFileSync('python3', ['-c', `
import openpyxl, sys, json
wb = openpyxl.load_workbook(sys.argv[1]); print(json.dumps(wb.sheetnames))`, files['pl.xlsx']]).toString());
  eq('P&L workbook has two sheets', x2.length, 2);
  const csv = fs.readFileSync(files['users.csv'], 'utf8');
  check('CSV has BOM, users and totals', csv.charCodeAt(0) === 0xFEFF && /Juan Santos,4,/.test(csv) && /Maria Cruz,1,6,390\.00/.test(csv), csv);
  const inv = fs.readFileSync(files['inventory.csv'], 'utf8');
  check('inventory movement: opening + deliveries - sales + adjustments = closing', /Diesel,Litre,10000,5000,54\.333,-81\.667,14864,51\.0000,758064\.00/.test(inv), inv);

  console.log('Backup export, preview and restore on a fresh device');
  await nav(page, 'settings');
  const [bdl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="export-backup"]').click()]);
  const backupFile = path.join(T.OUT, 'backup.json');
  await bdl.saveAs(backupFile);
  const bk = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  check('backup has version number and all record types', bk.format === 'gasstation-backup' && bk.backupVersion === 1 && ['users', 'products', 'sales', 'deliveries', 'expenses', 'meta', 'audit', 'shifts', 'customers'].every((k) => Array.isArray(bk.data[k])), Object.keys(bk.data));
  const summaryBefore = await page.evaluate(() => { const s = L.summary(U.today(), U.today()); return [s.sales, s.cogs, s.net, L.stockOf(DB.data.products.filter((p) => p.name === 'Diesel')[0].id)]; });

  const page2 = await T.open(browser, srv.url, { width: 800, height: 1280 });
  const bad = path.join(T.OUT, 'not-a-backup.json');
  fs.writeFileSync(bad, '{"hello": 1}');
  let [fc] = await Promise.all([page2.waitForEvent('filechooser'), page2.getByRole('button', { name: 'Restore from a backup file instead' }).click()]);
  await fc.setFiles(bad);
  check('invalid file is rejected with a clear message', (await page2.locator('.modal').innerText()).includes('not a Gas Station Manager backup'));
  await page2.locator('.modal').getByRole('button', { name: 'OK' }).click();
  [fc] = await Promise.all([page2.waitForEvent('filechooser'), page2.getByRole('button', { name: 'Restore from a backup file instead' }).click()]);
  await fc.setFiles(backupFile);
  const preview = await page2.locator('.modal').innerText();
  check('preview shows what the file contains', /Santos Fuel Station/.test(preview) && /Sales\s+5/.test(preview) && /juan \(Owner\)/.test(preview) && /Version 1/.test(preview), preview);
  await page2.screenshot({ path: path.join(T.OUT, 'restore-preview-portrait.png') });
  await page2.locator('.modal').getByRole('button', { name: 'Restore backup' }).click();
  await page2.waitForSelector('.banner.info');
  await T.login(page2, 'juan', 'secret123');
  await page2.waitForSelector('.shell');
  const summaryAfter = await page2.evaluate(() => { const s = L.summary(U.today(), U.today()); return [s.sales, s.cogs, s.net, L.stockOf(DB.data.products.filter((p) => p.name === 'Diesel')[0].id)]; });
  eq('restored data gives identical figures', JSON.stringify(summaryAfter), JSON.stringify(summaryBefore));
  await page2.reload();
  await page2.waitForSelector('.authcard');
  eq('data persists after closing and reopening the app', await page2.evaluate(() => DB.data.sales.length), 5);

  console.log('Older backup formats are migrated; newer ones are refused');
  const mig = await page2.evaluate((raw) => {
    const old = JSON.parse(raw);
    Backup.VERSION = 2;
    Backup.MIGRATIONS[1] = (o) => { o.data.sales.forEach((s) => { s.migratedFlag = true; }); return o; };
    const r = Backup.parse(JSON.stringify(old));
    old.backupVersion = 9;
    let refused = '';
    try { Backup.parse(JSON.stringify(old)); } catch (e) { refused = e.message; }
    Backup.VERSION = 1; delete Backup.MIGRATIONS[1];
    return { migrated: r.info.migrated, flagged: r.data.sales.every((s) => s.migratedFlag), from: r.info.version, refused };
  }, fs.readFileSync(backupFile, 'utf8'));
  check('version 1 backup upgraded through the migration chain', mig.migrated && mig.flagged && mig.from === 1, mig);
  check('backup from a newer app version is refused', /newer version/.test(mig.refused), mig.refused);

  console.log('Password hashing implementations agree');
  const kdf = await page2.evaluate(async () => {
    const pw = U.utf8('pässword ₱'), salt = U.unhex('000102030405060708090a0b0c0d0e0f');
    const a = U.hex(await Crypt.pbkdf2(pw, salt, 2000, false)), b = U.hex(await Crypt.pbkdf2(pw, salt, 2000, true));
    return { a, b, sha: U.hex(Crypt.sha256(U.utf8('abc'))) };
  });
  const nodeKdf = require('crypto').pbkdf2Sync(Buffer.from('pässword ₱', 'utf8'), Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'), 2000, 32, 'sha256').toString('hex');
  check('WebCrypto, pure-JS fallback and Node all give the same PBKDF2 hash', kdf.a === kdf.b && kdf.a === nodeKdf, kdf);
  eq('SHA-256 test vector', kdf.sha, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  console.log('Automatic sign-out after inactivity');
  const page3 = await T.open(browser, srv.url, { width: 1280, height: 800 });
  await page3.clock.install();
  await T.setup(page3, { station: 'Timeout Test' });
  await page3.evaluate(() => Settings.save({ autoLogoutMin: 1 }));
  await page3.clock.fastForward(50000);
  check('still signed in before the limit', await page3.locator('.shell').count() === 1);
  await page3.clock.fastForward(40000);
  await page3.waitForSelector('.authcard');
  check('signed out after 1 minute idle, with a reason', (await page3.locator('.authcard').innerText()).includes('without activity'));

  const errs = page.errors.concat(page2.errors, page3.errors);
  eq('no JavaScript errors during the run', errs.length, 0);
  if (errs.length) console.log(errs);
  await browser.close(); srv.close();
  console.log(T.failures() ? `\n${T.failures()} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(T.failures() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
