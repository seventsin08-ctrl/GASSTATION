'use strict';
/*
 * Business rules. Everything here works on the in-memory records in DB.data and saves through DB.put/DB.del.
 *
 *   current stock = starting stock + deliveries - sales +/- adjustments      (always derived, never stored)
 *   net profit    = sales - cost of goods sold - overhead expenses
 *
 * Each sale stores the unit price and unit cost in force when it was made, so later price or cost
 * changes never alter past profit figures.
 */
var L = (function () {
  var D = DB.data;
  var PAY = { cash: 'Cash', gcash: 'GCash', card: 'Card', credit: 'Credit' };
  var REASONS = { dipstick: 'Dipstick reading', evaporation: 'Evaporation', spillage: 'Spillage', correction: 'Correction' };
  var TYPES = {
    sale: { store: 'sales', label: 'Sale', icon: 'sell', tone: 'sky' },
    delivery: { store: 'deliveries', label: 'Delivery', icon: 'truck', tone: 'lav' },
    expense: { store: 'expenses', label: 'Expense', icon: 'expense', tone: 'cream' },
    adjustment: { store: 'adjustments', label: 'Stock adjustment', icon: 'adjust', tone: 'peach' },
    payment: { store: 'payments', label: 'Customer payment', icon: 'cash', tone: 'mint' }
  };
  var DEFAULT_CATEGORIES = ['Salaries', 'Electricity', 'Water', 'Rent', 'Repairs and maintenance', 'Permits and taxes', 'Supplies', 'Internet and phone', 'Other'];
  var COLORS = ['sky', 'lav', 'mint', 'cream', 'peach', 'rose'];

  var cache = { rev: -1 };
  function memo(key, fn) {
    if (cache.rev !== DB.rev) cache = { rev: DB.rev };
    if (!(key in cache)) cache[key] = fn();
    return cache[key];
  }
  function fail(msg) { throw new Error(msg); }
  function r2(n) { return U.round(n, 2); }
  function r3(n) { return U.round(n, 3); }
  function posNum(v, label, allowZero) {
    if (typeof v !== 'number' || !isFinite(v)) fail(label + ' is required.');
    if (v < 0) fail(label + ' cannot be negative.');
    if (!allowZero && v === 0) fail(label + ' must be more than zero.');
    return v;
  }

  // ------------------------------------------------------------------ lookups
  function product(id) { return DB.get('products', id); }
  function products(includeArchived) {
    return D.products.filter(function (p) { return includeArchived || !p.archived; })
      .sort(function (a, b) { return (a.unit === b.unit ? 0 : a.unit === 'L' ? -1 : 1) || (a.createdAt - b.createdAt); });
  }
  function productName(id) { var p = product(id); return p ? p.name : 'Deleted product'; }
  function unitOf(id) { var p = product(id); return p ? p.unit : 'L'; }
  function userName(id) { var u = DB.get('users', id); return u ? (u.displayName || u.username) : (id === 'system' ? 'Automatic' : 'Unknown user'); }
  function categories(includeArchived) {
    return D.categories.filter(function (c) { return includeArchived || !c.archived; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name); });
  }
  function catName(id) { var c = DB.get('categories', id); return c ? c.name : 'Uncategorised'; }
  function customers(includeArchived) {
    return D.customers.filter(function (c) { return includeArchived || !c.archived; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function customerName(id) { var c = DB.get('customers', id); return c ? c.name : 'Unknown customer'; }

  // ------------------------------------------------------------------ stock and cost
  function stockMap() {
    return memo('stock', function () {
      var m = {}, i;
      for (i = 0; i < D.products.length; i++) m[D.products[i].id] = D.products[i].startingStock || 0;
      for (i = 0; i < D.deliveries.length; i++) m[D.deliveries[i].productId] = (m[D.deliveries[i].productId] || 0) + D.deliveries[i].qty;
      for (i = 0; i < D.sales.length; i++) m[D.sales[i].productId] = (m[D.sales[i].productId] || 0) - D.sales[i].qty;
      for (i = 0; i < D.adjustments.length; i++) m[D.adjustments[i].productId] = (m[D.adjustments[i].productId] || 0) + D.adjustments[i].qty;
      return m;
    });
  }
  function stockOf(id) { return r3(stockMap()[id] || 0); }
  /** Stock at the start of `date` (before any movement dated that day). */
  function stockBefore(date) {
    var m = {}, i, r;
    for (i = 0; i < D.products.length; i++) m[D.products[i].id] = D.products[i].startingStock || 0;
    for (i = 0; i < D.deliveries.length; i++) { r = D.deliveries[i]; if (r.date < date) m[r.productId] = (m[r.productId] || 0) + r.qty; }
    for (i = 0; i < D.sales.length; i++) { r = D.sales[i]; if (r.date < date) m[r.productId] = (m[r.productId] || 0) - r.qty; }
    for (i = 0; i < D.adjustments.length; i++) { r = D.adjustments[i]; if (r.date < date) m[r.productId] = (m[r.productId] || 0) + r.qty; }
    return m;
  }
  function stockValue() {
    return r2(U.sum(products(false), function (p) { return Math.max(0, stockOf(p.id)) * (p.cost || 0); }));
  }
  function isLow(p) { return p.reorderLevel > 0 && stockOf(p.id) <= p.reorderLevel; }
  function lowStock() { return products(false).filter(isLow); }

  /** Weighted average cost after a delivery. With no stock on hand the delivery cost simply becomes the cost. */
  function weightedCost(stock, cost, qty, unitCost) {
    if (stock <= 0) return U.round(unitCost, 4);
    return U.round((stock * cost + qty * unitCost) / (stock + qty), 4);
  }
  /**
   * Recomputes a product's current cost by replaying its history in time order: deliveries move the
   * weighted average, sales and adjustments change the quantity on hand, manual cost edits reset it.
   */
  function replayCost(p) {
    var ev = [];
    D.deliveries.forEach(function (d) { if (d.productId === p.id) ev.push({ ts: d.ts, k: 'd', qty: d.qty, cost: d.unitCost }); });
    D.sales.forEach(function (s) { if (s.productId === p.id) ev.push({ ts: s.ts, k: 'q', qty: -s.qty }); });
    D.adjustments.forEach(function (a) { if (a.productId === p.id) ev.push({ ts: a.ts, k: 'q', qty: a.qty }); });
    D.priceHistory.forEach(function (x) { if (x.productId === p.id && x.manualCost) ev.push({ ts: x.ts, k: 'c', cost: x.cost }); });
    ev.sort(function (a, b) { return a.ts - b.ts; });
    var stock = p.startingStock || 0, cost = p.startingCost || 0;
    ev.forEach(function (e) {
      if (e.k === 'd') { cost = weightedCost(stock, cost, e.qty, e.cost); stock += e.qty; }
      else if (e.k === 'q') stock += e.qty;
      else cost = e.cost;
    });
    return U.round(cost, 4);
  }
  function previewDelivery(p, qty, unitCost) {
    var stock = stockOf(p.id);
    return { stockAfter: r3(stock + qty), newCost: weightedCost(stock, p.cost || 0, qty, unitCost), total: r2(qty * unitCost), overCapacity: p.capacity > 0 && stock + qty > p.capacity + 1e-9 };
  }

  // ------------------------------------------------------------------ audit log
  function audit(user, action, entity, entityId, summary, before, after) {
    return DB.put('audit', { id: U.uid(), ts: Date.now(), userId: user ? user.id : 'system', action: action, entity: entity, entityId: entityId || '',
      summary: summary || '', before: before || null, after: after || null });
  }
  function diff(before, after, skip) {
    var out = [];
    for (var k in after) {
      if (skip && skip.indexOf(k) >= 0) continue;
      var a = before[k], b = after[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push(k + ': ' + (a == null || a === '' ? '(empty)' : a) + ' → ' + (b == null || b === '' ? '(empty)' : b));
    }
    return out.join('; ');
  }

  // ------------------------------------------------------------------ products
  function priceEntry(p, user, reason, manualCost, refId) {
    return DB.put('priceHistory', { id: U.uid(), ts: Date.now(), productId: p.id, price: p.price, cost: p.cost, reason: reason, manualCost: !!manualCost, refId: refId || '', userId: user ? user.id : 'system' });
  }
  function checkProduct(v) {
    if (!v.name || !v.name.trim()) fail('Enter a product name.');
    posNum(v.price, 'Selling price', true); posNum(v.cost, 'Cost per unit', true);
    posNum(v.capacity, v.unit === 'L' ? 'Tank capacity' : 'Maximum stock', true);
    posNum(v.startingStock, 'Starting stock', true); posNum(v.reorderLevel, 'Reorder level', true);
    if (v.capacity > 0 && v.startingStock > v.capacity) fail('Starting stock is more than the ' + (v.unit === 'L' ? 'tank capacity' : 'maximum stock') + '.');
  }
  function createProduct(v, user) {
    checkProduct(v);
    var p = { id: U.uid(), name: v.name.trim(), unit: v.unit === 'L' ? 'L' : 'pc', price: r2(v.price), cost: U.round(v.cost, 4), startingCost: U.round(v.cost, 4),
      capacity: r3(v.capacity), startingStock: r3(v.startingStock), reorderLevel: r3(v.reorderLevel), color: v.color || COLORS[D.products.length % COLORS.length],
      archived: false, createdAt: Date.now(), createdBy: user ? user.id : 'system' };
    return DB.put('products', p).then(function () { return priceEntry(p, user, 'created', false); })
      .then(function () { return audit(user, 'create', 'product', p.id, 'Added product ' + p.name + ' at ' + U.money(p.price) + '/' + U.unitLabel(p.unit)); })
      .then(function () { return p; });
  }
  function updateProduct(p, v, user) {
    v.unit = p.unit;
    checkProduct(v);
    var before = U.clone(p);
    var priceChanged = r2(v.price) !== p.price, costChanged = U.round(v.cost, 4) !== p.cost;
    p.name = v.name.trim(); p.price = r2(v.price); p.cost = U.round(v.cost, 4); p.capacity = r3(v.capacity);
    p.startingStock = r3(v.startingStock); p.reorderLevel = r3(v.reorderLevel); if (v.color) p.color = v.color;
    var hasMoves = D.deliveries.concat(D.sales).some(function (r) { return r.productId === p.id; });
    if (costChanged && !hasMoves) p.startingCost = p.cost;
    return DB.put('products', p).then(function () {
      if (priceChanged || costChanged) return priceEntry(p, user, priceChanged && costChanged ? 'price and cost edited' : priceChanged ? 'price edited' : 'cost edited', costChanged);
    }).then(function () {
      var d = diff(before, p, ['startingCost']);
      if (d) return audit(user, 'edit', 'product', p.id, 'Edited product ' + p.name + ' — ' + d, before, U.clone(p));
    });
  }
  function archiveProduct(p, flag, user) {
    p.archived = !!flag;
    return DB.put('products', p).then(function () { return audit(user, flag ? 'archive' : 'restore', 'product', p.id, (flag ? 'Archived' : 'Restored') + ' product ' + p.name); });
  }
  function recalcCost(p, user, reason, refId) {
    var c = replayCost(p);
    if (c === p.cost) return Promise.resolve(c);
    p.cost = c;
    return DB.put('products', p).then(function () { return priceEntry(p, user, reason, false, refId); }).then(function () { return c; });
  }

  // ------------------------------------------------------------------ sales
  /** Works out quantity, total, cost and gross profit for an entry by quantity ('qty') or by peso amount ('amount'). */
  function saleCalc(p, mode, input) {
    var qty = 0, total = 0;
    input = +input || 0;
    if (p && input > 0) {
      if (mode === 'amount') {
        if (p.price > 0) {
          if (p.unit === 'L') { qty = r3(input / p.price); total = r2(input); }
          else { qty = Math.floor(input / p.price + 1e-9); total = r2(qty * p.price); }
        }
      } else {
        qty = p.unit === 'L' ? r3(input) : Math.floor(input + 1e-9);
        total = r2(qty * p.price);
      }
    }
    var cogs = p ? r2(qty * (p.cost || 0)) : 0;
    return { qty: qty, total: total, cogs: cogs, profit: r2(total - cogs), stock: p ? stockOf(p.id) : 0, exceeds: !!p && qty > stockOf(p.id) + 1e-9 };
  }
  function addSale(v, user) {
    var p = product(v.productId);
    if (!p || p.archived) fail('Choose a product.');
    if (!(p.price > 0)) fail('Set a selling price for ' + p.name + ' first.');
    var c = saleCalc(p, v.mode, v.input);
    if (!(c.qty > 0) || !(c.total > 0)) fail(v.mode === 'amount' ? 'Enter a peso amount.' : 'Enter a quantity.');
    if (!PAY[v.payment]) fail('Choose a payment type.');
    if (v.payment === 'credit' && !DB.get('customers', v.customerId)) fail('Choose the customer account for this credit sale.');
    var now = Date.now(), sh = currentShift(user.id);
    var s = { id: U.uid(), ts: now, date: U.dateStr(new Date(now)), productId: p.id, qty: c.qty, unitPrice: p.price, unitCost: p.cost || 0, total: c.total, cogs: c.cogs,
      mode: v.mode === 'amount' ? 'amount' : 'qty', payment: v.payment, customerId: v.payment === 'credit' ? v.customerId : '', note: (v.note || '').trim(),
      userId: user.id, shiftId: sh ? sh.id : '' };
    return DB.put('sales', s).then(function () { return s; });
  }
  function updateSale(s, v, user) {
    var p = product(v.productId);
    if (!p) fail('Choose a product.');
    posNum(v.qty, 'Quantity'); posNum(v.unitPrice, 'Unit price');
    if (p.unit !== 'L' && v.qty !== Math.floor(v.qty)) fail('Pieces must be a whole number.');
    if (!PAY[v.payment]) fail('Choose a payment type.');
    if (v.payment === 'credit' && !DB.get('customers', v.customerId)) fail('Choose the customer account for this credit sale.');
    if (!isFinite(v.ts)) fail('Enter a valid date and time.');
    var before = U.clone(s);
    var same = v.productId === s.productId && r3(v.qty) === s.qty && r2(v.unitPrice) === s.unitPrice;
    if (v.productId !== s.productId) s.unitCost = p.cost || 0;
    s.productId = v.productId; s.qty = r3(v.qty); s.unitPrice = r2(v.unitPrice);
    if (!same) s.total = r2(s.qty * s.unitPrice);
    s.cogs = r2(s.qty * s.unitCost);
    s.payment = v.payment; s.customerId = v.payment === 'credit' ? v.customerId : ''; s.note = (v.note || '').trim();
    s.ts = v.ts; s.date = U.dateStr(new Date(v.ts));
    return DB.put('sales', s).then(function () { return audit(user, 'edit', 'sale', s.id, 'Edited sale (' + describe('sale', s).title + ') — ' + (diff(before, s) || 'no changes'), before, U.clone(s)); });
  }

  // ------------------------------------------------------------------ deliveries
  function checkDelivery(v) {
    var p = product(v.productId);
    if (!p) fail('Choose a product.');
    posNum(v.qty, 'Quantity'); posNum(v.unitCost, 'Cost per unit');
    if (p.unit !== 'L' && v.qty !== Math.floor(v.qty)) fail('Pieces must be a whole number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) fail('Enter the delivery date.');
    if (v.date > U.today()) fail('The delivery date cannot be in the future.');
    return p;
  }
  function addDelivery(v, user) {
    var p = checkDelivery(v);
    var d = { id: U.uid(), ts: U.tsForDate(v.date), date: v.date, productId: p.id, qty: r3(v.qty), unitCost: U.round(v.unitCost, 4), total: r2(v.qty * v.unitCost),
      supplier: (v.supplier || '').trim(), drNumber: (v.drNumber || '').trim(), note: (v.note || '').trim(), userId: user.id, costBefore: p.cost || 0, costAfter: 0 };
    return DB.put('deliveries', d).then(function () { return recalcCost(p, user, 'delivery', d.id); })
      .then(function (c) { d.costAfter = c; return DB.put('deliveries', d); }).then(function () { return d; });
  }
  function updateDelivery(d, v, user) {
    var p = checkDelivery(v), before = U.clone(d), oldP = product(d.productId);
    if (v.date !== d.date) { d.date = v.date; d.ts = U.tsForDate(v.date); }
    d.productId = p.id; d.qty = r3(v.qty); d.unitCost = U.round(v.unitCost, 4); d.total = r2(d.qty * d.unitCost);
    d.supplier = (v.supplier || '').trim(); d.drNumber = (v.drNumber || '').trim(); d.note = (v.note || '').trim();
    return DB.put('deliveries', d).then(function () { return recalcCost(p, user, 'delivery edited', d.id); })
      .then(function () { if (oldP && oldP !== p) return recalcCost(oldP, user, 'delivery edited', d.id); })
      .then(function () { return audit(user, 'edit', 'delivery', d.id, 'Edited delivery (' + describe('delivery', d).title + ') — ' + (diff(before, d, ['ts']) || 'no changes'), before, U.clone(d)); });
  }

  // ------------------------------------------------------------------ stock adjustments
  /** v: {productId, reason, counted} for a dipstick reading, or {productId, reason, direction: 'add'|'remove', qty}. */
  function adjustmentQty(v) {
    var p = product(v.productId);
    if (!p) fail('Choose a product.');
    if (!REASONS[v.reason]) fail('Choose a reason.');
    var q;
    if (v.reason === 'dipstick') { posNum(v.counted, 'Measured stock', true); q = r3(v.counted - stockOf(p.id)); if (v.editing) q = r3(q + v.editing.qty); }
    else { posNum(v.qty, 'Quantity'); q = r3((v.reason === 'correction' && v.direction === 'add') ? v.qty : -v.qty); }
    if (p.unit !== 'L' && q !== Math.round(q)) fail('Pieces must be a whole number.');
    return q;
  }
  function addAdjustment(v, user) {
    var q = adjustmentQty(v);
    if (q === 0) fail('The measured stock matches the system stock, so there is nothing to adjust.');
    var now = Date.now();
    var a = { id: U.uid(), ts: now, date: U.dateStr(new Date(now)), productId: v.productId, qty: q, reason: v.reason, counted: v.reason === 'dipstick' ? r3(v.counted) : null,
      note: (v.note || '').trim(), userId: user.id };
    return DB.put('adjustments', a).then(function () { return a; });
  }
  function updateAdjustment(a, v, user) {
    posNum(Math.abs(v.qty), 'Quantity');
    if (!REASONS[v.reason]) fail('Choose a reason.');
    var p = product(a.productId);
    if (p && p.unit !== 'L' && v.qty !== Math.round(v.qty)) fail('Pieces must be a whole number.');
    var before = U.clone(a);
    a.qty = r3(v.qty); a.reason = v.reason; a.note = (v.note || '').trim();
    if (a.reason !== 'dipstick') a.counted = null;
    return DB.put('adjustments', a).then(function () { return audit(user, 'edit', 'adjustment', a.id, 'Edited stock adjustment (' + productName(a.productId) + ') — ' + (diff(before, a) || 'no changes'), before, U.clone(a)); });
  }

  // ------------------------------------------------------------------ expenses
  function checkExpense(v) {
    if (!DB.get('categories', v.categoryId)) fail('Choose a category.');
    posNum(v.amount, 'Amount');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date || '')) fail('Enter the expense date.');
  }
  function addExpense(v, user) {
    checkExpense(v);
    var e = { id: U.uid(), ts: U.tsForDate(v.date), date: v.date, categoryId: v.categoryId, amount: r2(v.amount), note: (v.note || '').trim(), userId: user ? user.id : 'system', recurringId: v.recurringId || '' };
    return DB.put('expenses', e).then(function () { return e; });
  }
  function updateExpense(e, v, user) {
    checkExpense(v);
    var before = U.clone(e);
    if (v.date !== e.date) { e.date = v.date; e.ts = U.tsForDate(v.date); }
    e.categoryId = v.categoryId; e.amount = r2(v.amount); e.note = (v.note || '').trim();
    return DB.put('expenses', e).then(function () { return audit(user, 'edit', 'expense', e.id, 'Edited expense (' + catName(e.categoryId) + ') — ' + (diff(before, e, ['ts']) || 'no changes'), before, U.clone(e)); });
  }
  function addCategory(name, user) {
    name = (name || '').trim();
    if (!name) fail('Enter a category name.');
    if (D.categories.some(function (c) { return c.name.toLowerCase() === name.toLowerCase() && !c.archived; })) fail('That category already exists.');
    var c = { id: U.uid(), name: name, builtin: false, archived: false, order: D.categories.length };
    return DB.put('categories', c).then(function () { return audit(user, 'create', 'category', c.id, 'Added expense category ' + name); }).then(function () { return c; });
  }
  function renameCategory(c, name, user) {
    name = (name || '').trim();
    if (!name) fail('Enter a category name.');
    var old = c.name; c.name = name;
    return DB.put('categories', c).then(function () { return audit(user, 'edit', 'category', c.id, 'Renamed expense category ' + old + ' → ' + name); });
  }
  function archiveCategory(c, flag, user) {
    c.archived = !!flag;
    return DB.put('categories', c).then(function () { return audit(user, flag ? 'archive' : 'restore', 'category', c.id, (flag ? 'Removed' : 'Restored') + ' expense category ' + c.name); });
  }
  function seedCategories() {
    if (D.categories.length) return Promise.resolve();
    return DEFAULT_CATEGORIES.reduce(function (pr, name, i) {
      return pr.then(function () { return DB.put('categories', { id: 'cat' + (i + 1), name: name, builtin: true, archived: false, order: i }); });
    }, Promise.resolve());
  }

  // ------------------------------------------------------------------ recurring monthly expenses
  function checkRecurring(v) {
    if (!DB.get('categories', v.categoryId)) fail('Choose a category.');
    posNum(v.amount, 'Amount');
    if (!(v.day >= 1 && v.day <= 31)) fail('Day of month must be between 1 and 31.');
    if (!/^\d{4}-\d{2}$/.test(v.startMonth || '')) fail('Choose the first month.');
  }
  function saveRecurring(r, v, user) {
    checkRecurring(v);
    var isNew = !r;
    if (isNew) r = { id: U.uid(), lastPosted: '', userId: user.id, createdAt: Date.now() };
    r.categoryId = v.categoryId; r.amount = r2(v.amount); r.day = Math.round(v.day); r.note = (v.note || '').trim(); r.active = v.active !== false;
    if (isNew || !r.lastPosted) r.startMonth = v.startMonth;
    return DB.put('recurring', r).then(function () {
      return audit(user, isNew ? 'create' : 'edit', 'recurring', r.id, (isNew ? 'Added' : 'Edited') + ' recurring expense ' + catName(r.categoryId) + ' ' + U.money(r.amount) + ' on day ' + r.day);
    }).then(function () { return postRecurring(); }).then(function () { return r; });
  }
  function recurringDate(r, ym) { return ym + '-' + U.pad(Math.min(r.day, U.daysInMonth(ym))); }
  function nextRecurringDate(r) {
    var m = r.lastPosted ? U.addMonths(r.lastPosted, 1) : r.startMonth;
    return recurringDate(r, m);
  }
  /** Creates the expense entries that have fallen due for every active recurring expense. Returns how many were added. */
  function postRecurring() {
    var today = U.today(), jobs = [], count = 0;
    D.recurring.forEach(function (r) {
      if (!r.active) return;
      var m = r.lastPosted ? U.addMonths(r.lastPosted, 1) : r.startMonth, guard = 0, posted = false;
      while (guard++ < 240) {
        var date = recurringDate(r, m);
        if (date > today) break;
        jobs.push({ r: r, date: date });
        r.lastPosted = m; posted = true;
        m = U.addMonths(m, 1);
      }
      if (posted) jobs.push({ r: r, save: true });
    });
    return jobs.reduce(function (pr, j) {
      return pr.then(function () {
        if (j.save) return DB.put('recurring', j.r);
        count++;
        return addExpense({ categoryId: j.r.categoryId, amount: j.r.amount, date: j.date, note: (j.r.note ? j.r.note + ' ' : '') + '(recurring)', recurringId: j.r.id }, { id: j.r.userId || 'system' });
      });
    }, Promise.resolve()).then(function () { return count; });
  }

  // ------------------------------------------------------------------ customers (credit accounts)
  function balances() {
    return memo('balances', function () {
      var m = {};
      D.sales.forEach(function (s) { if (s.payment === 'credit' && s.customerId) m[s.customerId] = (m[s.customerId] || 0) + s.total; });
      D.payments.forEach(function (p) { m[p.customerId] = (m[p.customerId] || 0) - p.amount; });
      return m;
    });
  }
  function balanceOf(id) { return r2(balances()[id] || 0); }
  function saveCustomer(c, v, user) {
    if (!v.name || !v.name.trim()) fail('Enter the customer name.');
    var isNew = !c;
    if (isNew) c = { id: U.uid(), archived: false, createdAt: Date.now(), createdBy: user.id };
    c.name = v.name.trim(); c.phone = (v.phone || '').trim(); c.note = (v.note || '').trim();
    return DB.put('customers', c).then(function () { return audit(user, isNew ? 'create' : 'edit', 'customer', c.id, (isNew ? 'Added' : 'Edited') + ' customer ' + c.name); }).then(function () { return c; });
  }
  function archiveCustomer(c, flag, user) {
    c.archived = !!flag;
    return DB.put('customers', c).then(function () { return audit(user, flag ? 'archive' : 'restore', 'customer', c.id, (flag ? 'Archived' : 'Restored') + ' customer ' + c.name); });
  }
  function checkPayment(v) {
    if (!DB.get('customers', v.customerId)) fail('Choose a customer.');
    posNum(v.amount, 'Amount');
    if (!PAY[v.method] || v.method === 'credit') fail('Choose how the customer paid.');
  }
  function addPayment(v, user) {
    checkPayment(v);
    var now = Date.now(), sh = currentShift(user.id);
    var p = { id: U.uid(), ts: now, date: U.dateStr(new Date(now)), customerId: v.customerId, amount: r2(v.amount), method: v.method, note: (v.note || '').trim(), userId: user.id, shiftId: sh ? sh.id : '' };
    return DB.put('payments', p).then(function () { return p; });
  }
  function updatePayment(p, v, user) {
    v.customerId = p.customerId;
    checkPayment(v);
    var before = U.clone(p);
    p.amount = r2(v.amount); p.method = v.method; p.note = (v.note || '').trim();
    return DB.put('payments', p).then(function () { return audit(user, 'edit', 'payment', p.id, 'Edited payment from ' + customerName(p.customerId) + ' — ' + (diff(before, p) || 'no changes'), before, U.clone(p)); });
  }

  // ------------------------------------------------------------------ delete (any entry type)
  function deleteEntry(type, rec, user) {
    var t = TYPES[type], d = describe(type, rec);
    return DB.del(t.store, rec.id).then(function () {
      if (type === 'delivery' && product(rec.productId)) return recalcCost(product(rec.productId), user, 'delivery deleted', rec.id);
    }).then(function () {
      return audit(user, 'delete', type, rec.id, 'Deleted ' + t.label.toLowerCase() + ': ' + d.title + ' (' + d.amountText + ', ' + U.fmtDate(rec.date) + ')', U.clone(rec), null);
    });
  }

  // ------------------------------------------------------------------ shifts
  function currentShift(userId) {
    for (var i = D.shifts.length - 1; i >= 0; i--) if (D.shifts[i].userId === userId && !D.shifts[i].closedAt) return D.shifts[i];
    return null;
  }
  function fuelProducts() { return products(false).filter(function (p) { return p.unit === 'L'; }); }
  function lastMeter(productId) {
    var best = null;
    D.shifts.forEach(function (s) {
      if (!s.closedAt) return;
      (s.meters || []).forEach(function (m) { if (m.productId === productId && m.close != null && (!best || s.closedAt > best.at)) best = { at: s.closedAt, v: m.close }; });
    });
    return best ? best.v : null;
  }
  function openShift(v, user) {
    if (currentShift(user.id)) fail('You already have an open shift.');
    posNum(v.openingCash, 'Opening cash', true);
    var meters = (v.meters || []).map(function (m) { posNum(m.open, 'Opening meter for ' + productName(m.productId), true); return { productId: m.productId, open: r3(m.open), close: null }; });
    var s = { id: U.uid(), userId: user.id, openedAt: Date.now(), closedAt: 0, openingCash: r2(v.openingCash), meters: meters, actualCash: null, expectedCash: null, note: '' };
    return DB.put('shifts', s).then(function () { return s; });
  }
  function shiftStats(s) {
    var st = { count: 0, total: 0, cash: 0, gcash: 0, card: 0, credit: 0, payCash: 0, payOther: 0, litres: {} };
    D.sales.forEach(function (x) {
      if (x.shiftId !== s.id) return;
      st.count++; st.total += x.total; st[x.payment] += x.total;
      st.litres[x.productId] = (st.litres[x.productId] || 0) + x.qty;
    });
    D.payments.forEach(function (x) { if (x.shiftId === s.id) { if (x.method === 'cash') st.payCash += x.amount; else st.payOther += x.amount; } });
    ['total', 'cash', 'gcash', 'card', 'credit', 'payCash', 'payOther'].forEach(function (k) { st[k] = r2(st[k]); });
    st.expectedCash = r2(s.openingCash + st.cash + st.payCash);
    st.meters = (s.meters || []).map(function (m) {
      var rec = r3(st.litres[m.productId] || 0), metered = m.close == null ? null : r3(m.close - m.open);
      return { productId: m.productId, open: m.open, close: m.close, metered: metered, recorded: rec, variance: metered == null ? null : r3(metered - rec) };
    });
    return st;
  }
  function closeShift(s, v, user) {
    posNum(v.actualCash, 'Cash counted', true);
    (s.meters || []).forEach(function (m) {
      var c = v.meters[m.productId];
      posNum(c, 'Closing meter for ' + productName(m.productId), true);
      if (c < m.open) fail('Closing meter for ' + productName(m.productId) + ' is lower than the opening reading (' + U.num(m.open, 3, true) + ').');
    });
    (s.meters || []).forEach(function (m) { m.close = r3(v.meters[m.productId]); });
    s.closedAt = Date.now(); s.actualCash = r2(v.actualCash); s.note = (v.note || '').trim();
    s.expectedCash = shiftStats(s).expectedCash;
    s.closedBy = user.id;
    return DB.put('shifts', s).then(function () { return s; });
  }
  function deleteShift(s, user) {
    return DB.del('shifts', s.id).then(function () { return audit(user, 'delete', 'shift', s.id, 'Deleted shift of ' + userName(s.userId) + ' opened ' + U.fmtDateTime(s.openedAt), U.clone(s), null); });
  }

  // ------------------------------------------------------------------ unified entry list
  function describe(type, r) {
    var d = { type: type, rec: r, icon: TYPES[type].icon, tone: TYPES[type].tone, sign: 0, amount: 0, amountText: '' };
    if (type === 'sale') {
      d.title = productName(r.productId) + ' · ' + U.qty(r.qty, unitOf(r.productId));
      d.sub = PAY[r.payment] + (r.customerId ? ' · ' + customerName(r.customerId) : '');
      d.amount = r.total; d.sign = 1; d.amountText = U.money(r.total);
    } else if (type === 'delivery') {
      d.title = 'Delivery · ' + productName(r.productId) + ' ' + U.qty(r.qty, unitOf(r.productId));
      d.sub = (r.supplier || 'No supplier') + (r.drNumber ? ' · DR ' + r.drNumber : '');
      d.amount = r.total; d.sign = -1; d.amountText = U.money(r.total);
    } else if (type === 'expense') {
      d.title = catName(r.categoryId);
      d.sub = r.note || 'Expense';
      d.amount = r.amount; d.sign = -1; d.amountText = U.money(r.amount);
    } else if (type === 'adjustment') {
      d.title = 'Adjustment · ' + productName(r.productId);
      d.sub = REASONS[r.reason] + (r.note ? ' · ' + r.note : '');
      d.amountText = (r.qty > 0 ? '+' : '') + U.qty(r.qty, unitOf(r.productId)); d.qtyOnly = true; d.sign = r.qty > 0 ? 1 : -1;
    } else {
      d.title = 'Payment · ' + customerName(r.customerId);
      d.sub = PAY[r.method] + (r.note ? ' · ' + r.note : '');
      d.amount = r.amount; d.sign = 1; d.amountText = U.money(r.amount);
    }
    return d;
  }
  /** f: {from, to, type, productId, userId, q}. Returns described entries, newest first. */
  function entries(f) {
    var out = [], q = (f.q || '').trim().toLowerCase();
    Object.keys(TYPES).forEach(function (type) {
      if (f.type && f.type !== type) return;
      if (f.productId && (type === 'expense' || type === 'payment')) return;
      var rows = D[TYPES[type].store];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (f.from && r.date < f.from) continue;
        if (f.to && r.date > f.to) continue;
        if (f.productId && r.productId !== f.productId) continue;
        if (f.userId && r.userId !== f.userId) continue;
        var d = describe(type, r);
        if (q && (d.title + ' ' + d.sub + ' ' + (r.note || '') + ' ' + (r.supplier || '') + ' ' + (r.drNumber || '') + ' ' + d.amountText + ' ' + userName(r.userId)).toLowerCase().indexOf(q) < 0) continue;
        out.push(d);
      }
    });
    out.sort(function (a, b) { return b.rec.ts - a.rec.ts; });
    return out;
  }

  // ------------------------------------------------------------------ dashboard summary
  function summary(from, to) {
    return memo('sum:' + from + ':' + to, function () {
      var s = { from: from, to: to, sales: 0, cogs: 0, overhead: 0, litres: 0, pieces: 0, count: 0, pay: { cash: 0, gcash: 0, card: 0, credit: 0 } };
      var days = {}, cats = {}, prods = {}, i, r, d;
      function day(date) { return days[date] || (days[date] = { date: date, sales: 0, cogs: 0, overhead: 0, count: 0 }); }
      for (i = 0; i < D.sales.length; i++) {
        r = D.sales[i];
        if (r.date < from || r.date > to) continue;
        s.sales += r.total; s.cogs += r.cogs; s.count++; s.pay[r.payment] += r.total;
        var unit = unitOf(r.productId);
        if (unit === 'L') s.litres += r.qty; else s.pieces += r.qty;
        d = day(r.date); d.sales += r.total; d.cogs += r.cogs; d.count++;
        var pp = prods[r.productId] || (prods[r.productId] = { id: r.productId, name: productName(r.productId), unit: unit, qty: 0, sales: 0, cogs: 0 });
        pp.qty += r.qty; pp.sales += r.total; pp.cogs += r.cogs;
      }
      for (i = 0; i < D.expenses.length; i++) {
        r = D.expenses[i];
        if (r.date < from || r.date > to) continue;
        s.overhead += r.amount; day(r.date).overhead += r.amount;
        cats[r.categoryId] = (cats[r.categoryId] || 0) + r.amount;
      }
      s.sales = r2(s.sales); s.cogs = r2(s.cogs); s.overhead = r2(s.overhead); s.litres = r3(s.litres);
      s.gross = r2(s.sales - s.cogs); s.net = r2(s.gross - s.overhead);
      s.margin = s.sales > 0 ? s.gross / s.sales * 100 : 0;
      s.days = Object.keys(days).sort().map(function (k) { var x = days[k]; x.gross = r2(x.sales - x.cogs); x.net = r2(x.gross - x.overhead); return x; });
      s.byCategory = Object.keys(cats).map(function (k) { return { id: k, name: catName(k), amount: r2(cats[k]) }; }).sort(function (a, b) { return b.amount - a.amount; });
      s.byProduct = Object.keys(prods).map(function (k) { var x = prods[k]; x.sales = r2(x.sales); x.cogs = r2(x.cogs); x.profit = r2(x.sales - x.cogs); return x; }).sort(function (a, b) { return b.profit - a.profit; });
      return s;
    });
  }
  /** Chart buckets for a period: one per day up to 31 days, otherwise one per month. */
  function series(from, to) {
    var s = summary(from, to), map = {}, out = [], byMonth = U.daysBetween(from, to) > 31;
    s.days.forEach(function (d) {
      var k = byMonth ? U.monthOf(d.date) : d.date;
      var b = map[k] || (map[k] = { sales: 0, gross: 0, overhead: 0 });
      b.sales += d.sales; b.gross += d.gross; b.overhead += d.overhead;
    });
    function push(k, label, long) { var b = map[k] || { sales: 0, gross: 0, overhead: 0 }; out.push({ key: k, label: label, long: long, sales: r2(b.sales), gross: r2(b.gross), net: r2(b.gross - b.overhead) }); }
    if (byMonth) {
      for (var m = U.monthOf(from), g = 0; m <= U.monthOf(to) && g < 120; m = U.addMonths(m, 1), g++) push(m, U.MONTHS[+m.slice(5) - 1], U.fmtMonth(m));
    } else {
      for (var d = from, g2 = 0; d <= to && g2 < 40; d = U.addDays(d, 1), g2++) push(d, String(+d.slice(8)), U.fmtDay(d));
    }
    return out;
  }

  // ------------------------------------------------------------------ reports
  // A report is {title, period, sections: [{name, columns: [{label, type}], rows: [[...]], totals: [...]}]}.
  // Column types: text, money, qty (3 decimals), int, pct, cost (4 decimals).
  function periodLabel(from, to) { return from === to ? U.fmtDate(from) : U.fmtDate(from) + ' – ' + U.fmtDate(to); }
  function col(label, type) { return { label: label, type: type || 'text' }; }

  function reportDailySales(from, to) {
    var s = summary(from, to), perDay = {};
    D.sales.forEach(function (r) {
      if (r.date < from || r.date > to) return;
      var d = perDay[r.date] || (perDay[r.date] = { litres: 0, cash: 0, gcash: 0, card: 0, credit: 0 });
      if (unitOf(r.productId) === 'L') d.litres += r.qty;
      d[r.payment] += r.total;
    });
    var rows = s.days.filter(function (d) { return d.count > 0; }).map(function (d) {
      var x = perDay[d.date];
      return [U.fmtDate(d.date), d.count, r3(x.litres), r2(d.sales), r2(d.cogs), d.gross, r2(x.cash), r2(x.gcash), r2(x.card), r2(x.credit)];
    });
    return { title: 'Daily sales', period: periodLabel(from, to), sections: [{ name: 'Sales by day',
      columns: [col('Date'), col('Sales count', 'int'), col('Litres', 'qty'), col('Sales', 'money'), col('Cost of goods', 'money'), col('Gross profit', 'money'), col('Cash', 'money'), col('GCash', 'money'), col('Card', 'money'), col('Credit', 'money')],
      rows: rows, totals: ['Total', s.count, s.litres, s.sales, s.cogs, s.gross, r2(s.pay.cash), r2(s.pay.gcash), r2(s.pay.card), r2(s.pay.credit)] }] };
  }
  function reportProfitLoss(from, to) {
    var s = summary(from, to), months = {};
    s.days.forEach(function (d) {
      var m = months[U.monthOf(d.date)] || (months[U.monthOf(d.date)] = { sales: 0, cogs: 0, overhead: 0 });
      m.sales += d.sales; m.cogs += d.cogs; m.overhead += d.overhead;
    });
    var rows = Object.keys(months).sort().map(function (k) {
      var m = months[k], gross = r2(m.sales - m.cogs);
      return [U.fmtMonth(k), r2(m.sales), r2(m.cogs), gross, r2(m.overhead), r2(gross - m.overhead), m.sales > 0 ? U.round(gross / m.sales * 100, 1) : 0];
    });
    return { title: 'Monthly profit and loss', period: periodLabel(from, to), sections: [
      { name: 'Profit and loss by month', columns: [col('Month'), col('Sales', 'money'), col('Cost of goods', 'money'), col('Gross profit', 'money'), col('Overhead', 'money'), col('Net profit', 'money'), col('Gross margin', 'pct')],
        rows: rows, totals: ['Total', s.sales, s.cogs, s.gross, s.overhead, s.net, U.round(s.margin, 1)] },
      { name: 'Overhead by category', columns: [col('Category'), col('Amount', 'money'), col('Share', 'pct')],
        rows: s.byCategory.map(function (c) { return [c.name, c.amount, s.overhead > 0 ? U.round(c.amount / s.overhead * 100, 1) : 0]; }), totals: ['Total', s.overhead, s.overhead > 0 ? 100 : 0] }] };
  }
  function reportInventory(from, to) {
    var open = stockBefore(from), mv = {};
    function m(id) { return mv[id] || (mv[id] = { del: 0, sold: 0, adj: 0 }); }
    D.deliveries.forEach(function (r) { if (r.date >= from && r.date <= to) m(r.productId).del += r.qty; });
    D.sales.forEach(function (r) { if (r.date >= from && r.date <= to) m(r.productId).sold += r.qty; });
    D.adjustments.forEach(function (r) { if (r.date >= from && r.date <= to) m(r.productId).adj += r.qty; });
    var totalValue = 0;
    var rows = products(true).filter(function (p) { return !p.archived || mv[p.id]; }).map(function (p) {
      var x = m(p.id), o = r3(open[p.id] || 0), close = r3(o + x.del - x.sold + x.adj), value = r2(Math.max(0, close) * (p.cost || 0));
      totalValue += value;
      return [p.name, p.unit === 'L' ? 'Litre' : 'Piece', o, r3(x.del), r3(x.sold), r3(x.adj), close, p.cost || 0, value];
    });
    return { title: 'Inventory movement', period: periodLabel(from, to), sections: [{ name: 'Stock movement by product',
      columns: [col('Product'), col('Unit'), col('Opening stock', 'qty'), col('Deliveries', 'qty'), col('Sales', 'qty'), col('Adjustments', 'qty'), col('Closing stock', 'qty'), col('Unit cost', 'cost'), col('Stock value', 'money')],
      rows: rows, totals: ['Total', '', null, null, null, null, null, null, r2(totalValue)] }] };
  }
  function reportExpenses(from, to) {
    var s = summary(from, to);
    var list = D.expenses.filter(function (e) { return e.date >= from && e.date <= to; }).sort(function (a, b) { return a.ts - b.ts; });
    return { title: 'Expenses', period: periodLabel(from, to), sections: [
      { name: 'By category', columns: [col('Category'), col('Amount', 'money'), col('Share', 'pct')],
        rows: s.byCategory.map(function (c) { return [c.name, c.amount, s.overhead > 0 ? U.round(c.amount / s.overhead * 100, 1) : 0]; }), totals: ['Total', s.overhead, s.overhead > 0 ? 100 : 0] },
      { name: 'All expenses', columns: [col('Date'), col('Category'), col('Note'), col('Recorded by'), col('Amount', 'money')],
        rows: list.map(function (e) { return [U.fmtDate(e.date), catName(e.categoryId), e.note || '', userName(e.userId), e.amount]; }), totals: ['Total', '', '', '', s.overhead] }] };
  }
  function reportSalesByUser(from, to) {
    var users = {}, t = { count: 0, litres: 0, sales: 0, gross: 0, cash: 0, gcash: 0, card: 0, credit: 0 };
    D.sales.forEach(function (r) {
      if (r.date < from || r.date > to) return;
      var u = users[r.userId] || (users[r.userId] = { count: 0, litres: 0, sales: 0, gross: 0, cash: 0, gcash: 0, card: 0, credit: 0 });
      var l = unitOf(r.productId) === 'L' ? r.qty : 0;
      u.count++; u.litres += l; u.sales += r.total; u.gross += r.total - r.cogs; u[r.payment] += r.total;
      t.count++; t.litres += l; t.sales += r.total; t.gross += r.total - r.cogs; t[r.payment] += r.total;
    });
    function line(name, u) { return [name, u.count, r3(u.litres), r2(u.sales), r2(u.gross), r2(u.cash), r2(u.gcash), r2(u.card), r2(u.credit)]; }
    return { title: 'Sales by user', period: periodLabel(from, to), sections: [{ name: 'Sales by user',
      columns: [col('User'), col('Sales count', 'int'), col('Litres', 'qty'), col('Sales', 'money'), col('Gross profit', 'money'), col('Cash', 'money'), col('GCash', 'money'), col('Card', 'money'), col('Credit', 'money')],
      rows: Object.keys(users).map(function (k) { return line(userName(k), users[k]); }).sort(function (a, b) { return b[3] - a[3]; }), totals: line('Total', t) }] };
  }
  function reportSalesByProduct(from, to) {
    var s = summary(from, to);
    return { title: 'Sales by product', period: periodLabel(from, to), sections: [{ name: 'Sales by product',
      columns: [col('Product'), col('Unit'), col('Quantity', 'qty'), col('Sales', 'money'), col('Cost of goods', 'money'), col('Gross profit', 'money'), col('Gross margin', 'pct')],
      rows: s.byProduct.map(function (p) { return [p.name, p.unit === 'L' ? 'Litre' : 'Piece', r3(p.qty), p.sales, p.cogs, p.profit, p.sales > 0 ? U.round(p.profit / p.sales * 100, 1) : 0]; }),
      totals: ['Total', '', null, s.sales, s.cogs, s.gross, U.round(s.margin, 1)] }] };
  }
  var REPORTS = [
    { id: 'daily', name: 'Daily sales', hint: 'Sales, cost and gross profit for each day', run: reportDailySales },
    { id: 'pl', name: 'Monthly profit and loss', hint: 'Sales, cost of goods, overhead and net profit by month', run: reportProfitLoss },
    { id: 'inventory', name: 'Inventory movement', hint: 'Opening stock, deliveries, sales, adjustments and closing stock', run: reportInventory },
    { id: 'expenses', name: 'Expenses', hint: 'Overhead by category and the full expense list', run: reportExpenses },
    { id: 'users', name: 'Sales by user', hint: 'Who sold how much, by payment type', run: reportSalesByUser },
    { id: 'products', name: 'Sales by product', hint: 'Quantity, sales and profit for each product', run: reportSalesByProduct }
  ];

  return {
    PAY: PAY, REASONS: REASONS, TYPES: TYPES, COLORS: COLORS, REPORTS: REPORTS,
    product: product, products: products, productName: productName, unitOf: unitOf, userName: userName, categories: categories, catName: catName,
    customers: customers, customerName: customerName, stockOf: stockOf, stockBefore: stockBefore, stockValue: stockValue, isLow: isLow, lowStock: lowStock,
    weightedCost: weightedCost, replayCost: replayCost, previewDelivery: previewDelivery, audit: audit,
    createProduct: createProduct, updateProduct: updateProduct, archiveProduct: archiveProduct,
    saleCalc: saleCalc, addSale: addSale, updateSale: updateSale, addDelivery: addDelivery, updateDelivery: updateDelivery,
    adjustmentQty: adjustmentQty, addAdjustment: addAdjustment, updateAdjustment: updateAdjustment,
    addExpense: addExpense, updateExpense: updateExpense, addCategory: addCategory, renameCategory: renameCategory, archiveCategory: archiveCategory, seedCategories: seedCategories,
    saveRecurring: saveRecurring, nextRecurringDate: nextRecurringDate, postRecurring: postRecurring,
    balanceOf: balanceOf, saveCustomer: saveCustomer, archiveCustomer: archiveCustomer, addPayment: addPayment, updatePayment: updatePayment,
    deleteEntry: deleteEntry, currentShift: currentShift, fuelProducts: fuelProducts, lastMeter: lastMeter, openShift: openShift, shiftStats: shiftStats, closeShift: closeShift, deleteShift: deleteShift,
    describe: describe, entries: entries, summary: summary, series: series, periodLabel: periodLabel
  };
})();
