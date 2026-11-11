// Fills the app with a few weeks of sample data and captures every screen at tablet and phone sizes,
// in light and dark mode. Output: tests/out/shot-*.png
//   NODE_PATH=$(npm root -g) node tests/screenshots.js
const T = require('./helpers.js');
const path = require('path');

async function seed(page) {
  await page.evaluate(async () => {
    const me = DB.data.users[0];
    const set = { 'Unleaded 91': [62.4, 54.1, 20000, 14200, 5000], 'Premium 95': [66.9, 57.8, 20000, 9800, 5000], 'Diesel': [58.75, 51.2, 25000, 6100, 6000], 'Engine Oil 1L': [350, 262, 120, 64, 12] };
    for (const p of DB.data.products) { const v = set[p.name]; await L.updateProduct(p, { name: p.name, price: v[0], cost: v[1], capacity: v[2], startingStock: v[3], reorderLevel: v[4], color: p.color }, me); }
    const hp = await Crypt.hashPassword('maria123');
    const maria = { id: 'u-maria', username: 'maria', displayName: 'Maria Cruz', role: 'cashier', salt: hp.salt, hash: hp.hash, iter: hp.iter, disabled: false, createdAt: Date.now() };
    await DB.put('users', maria);
    const cust = await L.saveCustomer(null, { name: 'ABC Trucking', phone: '0917 555 0101' }, me);
    let seedN = 7; const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
    const pays = ['cash', 'cash', 'cash', 'cash', 'gcash', 'gcash', 'card', 'credit'];
    const today = U.today();
    for (let d = 20; d >= 0; d--) {
      const date = U.addDays(today, -d);
      const n = 9 + Math.floor(rnd() * 8);
      for (let i = 0; i < n; i++) {
        const p = DB.data.products[Math.floor(rnd() * 3.12)], fuel = p.unit === 'L';
        const qty = fuel ? U.round(5 + rnd() * 55, 3) : 1 + Math.floor(rnd() * 2);
        const pay = pays[Math.floor(rnd() * pays.length)];
        const ts = U.parseDate(date).getTime() + (6 + rnd() * 14) * 3600000;
        if (d === 0 && ts > Date.now()) continue;
        await DB.put('sales', { id: U.uid() + i, ts, date, productId: p.id, qty, unitPrice: p.price, unitCost: p.cost, total: U.round(qty * p.price, 2), cogs: U.round(qty * p.cost, 2), mode: 'qty', payment: pay,
          customerId: pay === 'credit' ? cust.id : '', note: '', userId: rnd() < 0.6 ? maria.id : me.id, shiftId: '' });
      }
    }
    await L.addDelivery({ productId: DB.data.products[2].id, date: U.addDays(today, -9), qty: 8000, unitCost: 51.9, supplier: 'Petron Depot', drNumber: 'DR-20418' }, me);
    await L.addDelivery({ productId: DB.data.products[0].id, date: U.addDays(today, -4), qty: 6000, unitCost: 54.6, supplier: 'Petron Depot', drNumber: 'DR-20455' }, me);
    const cat = (n) => DB.data.categories.filter((c) => c.name === n)[0].id;
    await L.addExpense({ categoryId: cat('Salaries'), amount: 18500, date: U.addDays(today, -6), note: 'Half-month payroll' }, me);
    await L.addExpense({ categoryId: cat('Electricity'), amount: 7420.5, date: U.addDays(today, -3), note: 'Meralco' }, me);
    await L.addExpense({ categoryId: cat('Repairs and maintenance'), amount: 2300, date: U.addDays(today, -2), note: 'Pump 2 nozzle' }, me);
    await L.addExpense({ categoryId: cat('Internet and phone'), amount: 1899, date: U.addDays(today, -1), note: '' }, me);
    await L.addExpense({ categoryId: cat('Supplies'), amount: 640, date: today, note: 'Receipt paper' }, me);
    await L.saveRecurring(null, { categoryId: cat('Rent'), amount: 25000, day: 1, startMonth: U.monthOf(today), note: 'Lot rental', active: true }, me);
    await L.addPayment({ customerId: cust.id, amount: 5000, method: 'cash', note: '' }, me);
    await Settings.save({ address: '123 Rizal Avenue, Parañaque City' });
  });
}

(async () => {
  const srv = await T.serve();
  const browser = await T.chromium.launch();
  const sizes = { tablet: { width: 1280, height: 800 }, portrait: { width: 800, height: 1280 }, phone: { width: 390, height: 800 } };
  const page = await T.open(browser, srv.url, sizes.tablet, { deviceScaleFactor: 2 });
  await T.setup(page);
  await seed(page);
  const views = ['dashboard', 'sell', 'transactions', 'inventory', 'expenses', 'reports', 'customers', 'shifts', 'settings'];
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => App.setTheme(t), theme);
    for (const size of Object.keys(sizes)) {
      await page.setViewportSize(sizes[size]);
      for (const v of (theme === 'dark' ? ['dashboard', 'sell', 'inventory'] : views)) {
        await page.evaluate((id) => App.go(id, id === 'dashboard' ? {} : {}), v);
        if (v === 'dashboard') { await page.locator('.pill[data-v="7d"]').click(); }
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(T.OUT, `shot-${theme}-${size}-${v}.png`), fullPage: false });
      }
    }
  }
  console.log('errors:', page.errors);
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
