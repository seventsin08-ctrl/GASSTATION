'use strict';
/* Entry forms (add / edit) and the entry detail dialog. Editing and deleting are Owner-only and always audited. */
var Forms = (function () {
  function me() { return App.user(); }
  function saved(msg) { UI.toast(msg); App.refresh(); }
  function prodOptions(keepId, first) {
    var list = L.products(true).filter(function (p) { return !p.archived || p.id === keepId; }).map(function (p) { return { value: p.id, label: p.name + (p.archived ? ' (archived)' : '') }; });
    return first ? [{ value: '', label: first }].concat(list) : list;
  }
  function unitOfForm(v) { return L.unitOf(v.productId); }
  function qtyDecimals(v) { return unitOfForm(v) === 'L' ? 3 : 0; }
  function qtySuffix(v) { return unitOfForm(v) === 'L' ? 'L' : 'pcs'; }
  function payOptions(noCredit) { return Object.keys(L.PAY).filter(function (k) { return !(noCredit && k === 'credit'); }).map(function (k) { return { value: k, label: L.PAY[k] }; }); }
  function customerOptions(keepId) {
    return [{ value: '', label: 'Choose customer…' }].concat(L.customers(true).filter(function (c) { return !c.archived || c.id === keepId; }).map(function (c) { return { value: c.id, label: c.name }; }));
  }

  // ------------------------------------------------------------------ product
  function product(p) {
    var isNew = !p, unit = p ? p.unit : 'L';
    var hasMoves = !!p && DB.data.sales.concat(DB.data.deliveries, DB.data.adjustments).some(function (r) { return r.productId === p.id; });
    UI.form({
      title: isNew ? 'Add product' : 'Edit ' + p.name, size: 'wide',
      fields: [
        { key: 'name', label: 'Product name', placeholder: 'e.g. Diesel', value: p ? p.name : '', caps: 'words', full: true },
        isNew ? { key: 'unit', label: 'Sold by', type: 'seg', value: 'L', options: [{ value: 'L', label: 'Litre (fuel)', icon: 'drop' }, { value: 'pc', label: 'Piece (item)', icon: 'box' }] } : null,
        { key: 'price', label: 'Selling price', type: 'money', value: p ? p.price : null, suffix: function (v) { return '/ ' + U.unitLabel(v.unit || unit); } },
        { key: 'cost', label: 'Cost per unit', type: 'cost', value: p ? p.cost : null, suffix: function (v) { return '/ ' + U.unitLabel(v.unit || unit); },
          hint: hasMoves ? 'Deliveries update this automatically (weighted average). Change it only to correct it.' : 'What you pay your supplier per unit.' },
        { key: 'capacity', label: 'Tank capacity', type: 'qty', value: p ? p.capacity : null, decimals: function (v) { return (v.unit || unit) === 'L' ? 3 : 0; } },
        { key: 'startingStock', label: 'Starting stock', type: 'qty', value: p ? p.startingStock : null, decimals: function (v) { return (v.unit || unit) === 'L' ? 3 : 0; },
          hint: hasMoves ? 'Stock on hand before the first entry in this app. Use a stock adjustment for corrections.' : 'What is in the tank or on the shelf right now.' },
        { key: 'reorderLevel', label: 'Reorder level', type: 'qty', value: p ? p.reorderLevel : null, decimals: function (v) { return (v.unit || unit) === 'L' ? 3 : 0; }, hint: 'You get a low-stock warning at or below this.' },
        { key: 'color', label: 'Card colour', type: 'swatch', value: p ? p.color : L.COLORS[DB.data.products.length % L.COLORS.length], options: L.COLORS }
      ].filter(Boolean),
      onChange: function (v, api, key) { if (key === null || key === 'unit') api.label('capacity', (v.unit || unit) === 'L' ? 'Tank capacity' : 'Maximum stock'); },
      actions: p ? [{ label: p.archived ? 'Restore' : 'Archive', kind: p.archived ? '' : 'danger', icon: p.archived ? 'history' : 'box', onClick: function (api) {
        (p.archived ? Promise.resolve(true) : UI.confirm({ title: 'Archive ' + p.name + '?', message: 'It will be hidden from the Sell screen and stock lists. Past sales and reports keep it. You can restore it later.', confirmLabel: 'Archive', danger: true }))
          .then(function (ok) { if (ok) return L.archiveProduct(p, !p.archived, me()).then(function () { api.close(); saved(p.archived ? 'Product archived' : 'Product restored'); }); });
      } }] : [],
      onSubmit: function (v) {
        var d = { name: v.name, unit: v.unit || unit, price: v.price || 0, cost: v.cost || 0, capacity: v.capacity || 0, startingStock: v.startingStock || 0, reorderLevel: v.reorderLevel || 0, color: v.color };
        return (isNew ? L.createProduct(d, me()) : L.updateProduct(p, d, me())).then(function () { saved(isNew ? 'Product added' : 'Product saved'); });
      }
    });
  }

  // ------------------------------------------------------------------ delivery
  function delivery(d, presetId) {
    var suppliers = {}, list = prodOptions(d && d.productId);
    DB.data.deliveries.forEach(function (x) { if (x.supplier) suppliers[x.supplier] = 1; });
    if (!list.length) return UI.alert('No products yet', 'Add a product first.');
    var first = d ? d.productId : (presetId || list[0].value), p0 = L.product(first);
    UI.form({
      title: d ? 'Edit delivery' : 'Record delivery', size: 'wide',
      fields: [
        { key: 'productId', label: 'Product', type: 'select', options: list, value: first },
        { key: 'date', label: 'Delivery date', type: 'date', value: d ? d.date : U.today(), max: U.today() },
        { key: 'qty', label: 'Quantity delivered', type: 'qty', value: d ? d.qty : null, decimals: qtyDecimals, suffix: qtySuffix },
        { key: 'unitCost', label: 'Cost per unit', type: 'cost', value: d ? d.unitCost : (p0 && p0.cost ? p0.cost : null), suffix: function (v) { return '/ ' + U.unitLabel(unitOfForm(v)); } },
        { key: 'supplier', label: 'Supplier', placeholder: 'e.g. Petron Depot', value: d ? d.supplier : '', list: Object.keys(suppliers), caps: 'words' },
        { key: 'drNumber', label: 'Delivery receipt no.', placeholder: 'DR number', value: d ? d.drNumber : '', caps: 'characters' },
        { key: 'note', label: 'Note (optional)', type: 'textarea', value: d ? d.note : '' },
        { key: 'info', type: 'info', value: '' }
      ],
      onChange: function (v, api) {
        var p = L.product(v.productId);
        if (!p || !(v.qty > 0) || !(v.unitCost > 0)) return api.set('info', 'Enter the quantity and cost to see the total and the new average cost.');
        var pv = L.previewDelivery(p, v.qty, v.unitCost);
        api.set('info', [h('div', 'Total cost: ', h('b', U.money(pv.total))),
          d ? null : h('div', 'New average cost: ', h('b', '₱' + U.num(pv.newCost, 4) + ' / ' + U.unitLabel(p.unit)), h('span.muted', ' (now ₱' + U.num(p.cost || 0, 4) + ')')),
          d ? null : h('div' + (pv.overCapacity ? '.warn' : ''), 'Stock after delivery: ', h('b', U.qty(pv.stockAfter, p.unit)), p.capacity > 0 ? ' of ' + U.qty(p.capacity, p.unit) + (pv.overCapacity ? ' — more than the tank holds' : '') : '')]);
      },
      onSubmit: function (v) {
        var val = { productId: v.productId, date: v.date, qty: v.qty, unitCost: v.unitCost, supplier: v.supplier, drNumber: v.drNumber, note: v.note };
        if (d) return L.updateDelivery(d, val, me()).then(function () { saved('Delivery updated'); });
        var p = L.product(v.productId), over = p && v.qty > 0 && L.previewDelivery(p, v.qty, v.unitCost || 0).overCapacity;
        return (over ? UI.confirm({ title: 'More than the tank holds', message: 'This delivery brings ' + p.name + ' above its capacity of ' + U.qty(p.capacity, p.unit) + '. Record it anyway?', confirmLabel: 'Record anyway' }) : Promise.resolve(true))
          .then(function (ok) { if (!ok) return false; return L.addDelivery(val, me()).then(function () { saved('Delivery recorded · stock and cost updated'); }); });
      }
    });
  }

  // ------------------------------------------------------------------ stock adjustment
  function adjustment(a, presetId) {
    var reasons = Object.keys(L.REASONS).map(function (k) { return { value: k, label: L.REASONS[k] }; });
    if (a) {
      return UI.form({
        title: 'Edit stock adjustment', intro: L.productName(a.productId) + ' · ' + U.fmtDateTime(a.ts),
        fields: [
          { key: 'reason', label: 'Reason', type: 'select', options: reasons, value: a.reason },
          { key: 'direction', label: 'Change', type: 'seg', value: a.qty > 0 ? 'add' : 'remove', options: [{ value: 'remove', label: 'Remove stock' }, { value: 'add', label: 'Add stock' }] },
          { key: 'qty', label: 'Quantity', type: 'qty', value: Math.abs(a.qty), decimals: L.unitOf(a.productId) === 'L' ? 3 : 0, suffix: L.unitOf(a.productId) === 'L' ? 'L' : 'pcs' },
          { key: 'note', label: 'Note (optional)', type: 'textarea', value: a.note }
        ],
        onSubmit: function (v) { return L.updateAdjustment(a, { qty: (v.direction === 'add' ? 1 : -1) * (v.qty || 0), reason: v.reason, note: v.note }, me()).then(function () { saved('Adjustment updated'); }); }
      });
    }
    var list = prodOptions();
    if (!list.length) return UI.alert('No products yet', 'Add a product first.');
    UI.form({
      title: 'Adjust stock',
      fields: [
        { key: 'productId', label: 'Product', type: 'select', options: list, value: presetId || list[0].value, full: true },
        { key: 'reason', label: 'Reason', type: 'select', options: reasons, value: 'dipstick', full: true },
        { key: 'counted', label: 'Measured stock (dipstick)', type: 'qty', decimals: qtyDecimals, suffix: qtySuffix, full: true },
        { key: 'direction', label: 'Change', type: 'seg', value: 'remove', options: [{ value: 'remove', label: 'Remove stock' }, { value: 'add', label: 'Add stock' }], hidden: true },
        { key: 'qty', label: 'Quantity lost', type: 'qty', decimals: qtyDecimals, suffix: qtySuffix, full: true, hidden: true },
        { key: 'note', label: 'Note (optional)', type: 'textarea' }
      ],
      onChange: function (v, api) {
        var p = L.product(v.productId), dip = v.reason === 'dipstick', stock = p ? L.stockOf(p.id) : 0;
        api.show('counted', dip); api.show('qty', !dip); api.show('direction', v.reason === 'correction');
        api.label('qty', v.reason === 'correction' ? 'Quantity' : 'Quantity lost');
        if (!p) return;
        if (dip) {
          var diff = v.counted == null ? null : U.round(v.counted - stock, 3);
          api.hint('counted', 'System stock is ' + U.qty(stock, p.unit) + '.' + (diff == null ? '' : diff === 0 ? ' The reading matches.' : ' Stock will change by ' + (diff > 0 ? '+' : '') + U.qty(diff, p.unit) + '.'), diff != null && diff !== 0);
        } else api.hint('qty', 'System stock is ' + U.qty(stock, p.unit) + '.');
      },
      onSubmit: function (v) { return L.addAdjustment(v, me()).then(function (a2) { saved('Stock adjusted by ' + (a2.qty > 0 ? '+' : '') + U.qty(a2.qty, L.unitOf(a2.productId))); }); }
    });
  }

  // ------------------------------------------------------------------ expense and recurring expense
  function catOptions(keepId) {
    return L.categories(true).filter(function (c) { return !c.archived || c.id === keepId; }).map(function (c) { return { value: c.id, label: c.name }; });
  }
  function expense(e) {
    var cats = catOptions(e && e.categoryId);
    UI.form({
      title: e ? 'Edit expense' : 'Add expense',
      fields: [
        { key: 'categoryId', label: 'Category', type: 'select', options: cats, value: e ? e.categoryId : (cats[0] && cats[0].value) },
        { key: 'amount', label: 'Amount', type: 'money', value: e ? e.amount : null },
        { key: 'date', label: 'Date', type: 'date', value: e ? e.date : U.today() },
        { key: 'note', label: 'Note (optional)', type: 'textarea', value: e ? e.note : '', placeholder: 'e.g. October electric bill' }
      ],
      onSubmit: function (v) { return (e ? L.updateExpense(e, v, me()) : L.addExpense(v, me())).then(function () { saved(e ? 'Expense updated' : 'Expense added'); }); }
    });
  }
  function recurring(r) {
    var cats = catOptions(r && r.categoryId), months = [], m = U.addMonths(U.monthOf(U.today()), -12);
    for (var i = 0; i < 25; i++) { months.push({ value: m, label: U.fmtMonth(m) }); m = U.addMonths(m, 1); }
    var locked = !!(r && r.lastPosted);
    UI.form({
      title: r ? 'Edit recurring expense' : 'Add recurring expense',
      intro: 'A matching expense is added automatically every month on the day you choose.',
      fields: [
        { key: 'categoryId', label: 'Category', type: 'select', options: cats, value: r ? r.categoryId : (cats[0] && cats[0].value) },
        { key: 'amount', label: 'Amount each month', type: 'money', value: r ? r.amount : null },
        { key: 'day', label: 'Day of the month', type: 'int', value: r ? r.day : 1, hint: 'Months with fewer days use their last day.' },
        locked ? null : { key: 'startMonth', label: 'First month', type: 'select', options: months, value: r ? r.startMonth : U.monthOf(U.today()) },
        { key: 'note', label: 'Note (optional)', value: r ? r.note : '', placeholder: 'e.g. Lot rental', full: true },
        { key: 'active', type: 'toggle', text: 'Active', value: r ? r.active : true, full: true }
      ].filter(Boolean),
      actions: r ? [{ label: 'Delete', kind: 'danger', icon: 'trash', onClick: function (api) {
        UI.confirm({ title: 'Delete this recurring expense?', message: 'No more expenses will be added for it. Expenses already added stay in your records.', confirmLabel: 'Delete', danger: true }).then(function (ok) {
          if (ok) return DB.del('recurring', r.id).then(function () { return L.audit(me(), 'delete', 'recurring', r.id, 'Deleted recurring expense ' + L.catName(r.categoryId) + ' ' + U.money(r.amount), U.clone(r)); }).then(function () { api.close(); saved('Recurring expense deleted'); });
        });
      } }] : [],
      onSubmit: function (v) {
        return L.saveRecurring(r, { categoryId: v.categoryId, amount: v.amount, day: v.day, startMonth: locked ? r.startMonth : v.startMonth, note: v.note, active: v.active }, me()).then(function () { saved('Recurring expense saved'); });
      }
    });
  }
  function categories() {
    var body = h('div');
    function draw() {
      U.clear(body);
      U.append(body, [h('div.list', L.categories(false).map(function (c) {
        return h('div.item', h('div.bubble.cream', U.icon('tag', 20)), h('div.grow', h('div.t.ell', c.name), h('div.s', c.builtin ? 'Standard category' : 'Added by you')),
          h('button.iconbtn', { type: 'button', 'aria-label': 'Rename ' + c.name, onclick: function () {
            UI.form({ title: 'Rename category', columns: 1, fields: [{ key: 'name', label: 'Category name', value: c.name, caps: 'words' }], onSubmit: function (v) { return L.renameCategory(c, v.name, me()).then(function () { draw(); App.refresh(); }); } });
          } }, U.icon('edit', 18)),
          h('button.iconbtn', { type: 'button', 'aria-label': 'Remove ' + c.name, onclick: function () {
            UI.confirm({ title: 'Remove ' + c.name + '?', message: 'It will no longer be offered for new expenses. Existing expenses keep this category.', confirmLabel: 'Remove', danger: true })
              .then(function (ok) { if (ok) return L.archiveCategory(c, true, me()).then(function () { draw(); App.refresh(); }); });
          } }, U.icon('trash', 18)));
      })),
      h('button.btn.accent.block', { type: 'button', style: { marginTop: '12px' }, onclick: function () {
        UI.form({ title: 'New expense category', columns: 1, fields: [{ key: 'name', label: 'Category name', placeholder: 'e.g. Security', caps: 'words' }], submit: 'Add', onSubmit: function (v) { return L.addCategory(v.name, me()).then(function () { draw(); App.refresh(); }); } });
      } }, U.icon('plus', 18), 'Add category')]);
    }
    draw();
    UI.modal({ title: 'Expense categories', body: body });
  }

  // ------------------------------------------------------------------ customers and payments
  function customer(c, onSaved) {
    UI.form({
      title: c ? 'Edit customer' : 'Add customer account', columns: 1,
      fields: [{ key: 'name', label: 'Customer or company name', value: c ? c.name : '', caps: 'words' }, { key: 'phone', label: 'Phone (optional)', value: c ? c.phone : '', type: 'tel' }, { key: 'note', label: 'Note (optional)', value: c ? c.note : '' }],
      onSubmit: function (v) { return L.saveCustomer(c, v, me()).then(function (x) { saved(c ? 'Customer saved' : 'Customer added'); if (onSaved) onSaved(x); }); }
    });
  }
  function payment(p, customerId) {
    var cid = p ? p.customerId : customerId, bal = L.balanceOf(cid);
    UI.form({
      title: p ? 'Edit payment' : 'Record payment', columns: 1, intro: L.customerName(cid) + ' · owes ' + U.money(bal),
      fields: [{ key: 'amount', label: 'Amount received', type: 'money', value: p ? p.amount : (bal > 0 ? bal : null) }, { key: 'method', label: 'Paid by', type: 'seg', options: payOptions(true), value: p ? p.method : 'cash' }, { key: 'note', label: 'Note (optional)', value: p ? p.note : '' }],
      onSubmit: function (v) {
        var val = { customerId: cid, amount: v.amount, method: v.method, note: v.note };
        return (p ? L.updatePayment(p, val, me()) : L.addPayment(val, me())).then(function () { saved(p ? 'Payment updated' : 'Payment recorded'); });
      }
    });
  }
  /** Lets the cashier choose which account a credit sale goes to. */
  function pickCustomer(cb) {
    var q = '', listEl = h('div.list'), m;
    function draw() {
      U.clear(listEl);
      var rows = L.customers(false).filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) >= 0; });
      if (!rows.length) listEl.appendChild(UI.empty('credit', q ? 'No match' : 'No customer accounts yet', App.isOwner() ? 'Add the customer to sell on credit.' : 'Ask the Owner to add the customer account.'));
      rows.forEach(function (c) {
        listEl.appendChild(UI.item({ icon: 'user', tone: 'lav', title: c.name, sub: c.phone || 'Customer account', right: U.money(L.balanceOf(c.id)), rightSub: 'owes' }, function () { m.close(); cb(c); }));
      });
    }
    draw();
    m = UI.modal({ title: 'Choose customer account',
      body: h('div.stack', h('input.input', { type: 'search', placeholder: 'Search customers', oninput: function (e) { q = e.target.value.trim().toLowerCase(); draw(); } }), listEl),
      actions: App.isOwner() ? [{ label: 'New customer', kind: 'accent', icon: 'plus', onClick: function () { customer(null, function (c) { m.close(); cb(c); }); } }] : [] });
  }

  // ------------------------------------------------------------------ sale (edit only; new sales come from the Sell screen)
  function sale(s) {
    UI.form({
      title: 'Edit sale', size: 'wide',
      fields: [
        { key: 'productId', label: 'Product', type: 'select', options: prodOptions(s.productId), value: s.productId },
        { key: 'when', label: 'Date and time', type: 'datetime', value: U.toLocalInput(s.ts) },
        { key: 'qty', label: 'Quantity', type: 'qty', value: s.qty, decimals: qtyDecimals, suffix: qtySuffix },
        { key: 'unitPrice', label: 'Unit price', type: 'money', value: s.unitPrice },
        { key: 'payment', label: 'Payment type', type: 'select', options: payOptions(), value: s.payment },
        { key: 'customerId', label: 'Customer account', type: 'select', options: customerOptions(s.customerId), value: s.customerId || '' },
        { key: 'note', label: 'Note (optional)', type: 'textarea', value: s.note }
      ],
      onChange: function (v, api) { api.show('customerId', v.payment === 'credit'); },
      onSubmit: function (v) {
        return L.updateSale(s, { productId: v.productId, qty: v.qty, unitPrice: v.unitPrice, payment: v.payment, customerId: v.customerId, note: v.note, ts: U.fromLocalInput(v.when) }, me()).then(function () { saved('Sale updated'); });
      }
    });
  }

  // ------------------------------------------------------------------ entry detail (view, edit, delete)
  var EDIT = { sale: sale, delivery: delivery, expense: expense, adjustment: adjustment, payment: payment };
  function detail(type, r) {
    var owner = App.isOwner(), t = L.TYPES[type], d = L.describe(type, r), rows, unit = r.productId ? L.unitOf(r.productId) : '';
    if (type === 'sale') {
      rows = [['Product', L.productName(r.productId)], ['Quantity', U.qty(r.qty, unit)], ['Unit price', U.money(r.unitPrice) + ' / ' + U.unitLabel(unit)], ['Total', U.money(r.total)],
        owner ? ['Unit cost', '₱' + U.num(r.unitCost, 4)] : null, owner ? ['Cost of goods', U.money(r.cogs)] : null, owner ? ['Gross profit', U.money(r.total - r.cogs), r.total - r.cogs < 0 ? 'neg' : 'pos'] : null,
        ['Payment', L.PAY[r.payment]], r.customerId ? ['Customer', L.customerName(r.customerId)] : null, ['Entered as', r.mode === 'amount' ? 'Peso amount' : 'Quantity']];
    } else if (type === 'delivery') {
      rows = [['Product', L.productName(r.productId)], ['Quantity', U.qty(r.qty, unit)], ['Cost per unit', '₱' + U.num(r.unitCost, 4)], ['Total cost', U.money(r.total)], ['Supplier', r.supplier], ['Delivery receipt no.', r.drNumber],
        ['Average cost after', r.costAfter ? '₱' + U.num(r.costAfter, 4) : '']];
    } else if (type === 'expense') {
      rows = [['Category', L.catName(r.categoryId)], ['Amount', U.money(r.amount)], r.recurringId ? ['Source', 'Recurring monthly expense'] : null];
    } else if (type === 'adjustment') {
      rows = [['Product', L.productName(r.productId)], ['Stock change', d.amountText, r.qty < 0 ? 'neg' : 'pos'], ['Reason', L.REASONS[r.reason]], r.counted != null ? ['Measured stock', U.qty(r.counted, unit)] : null];
    } else {
      rows = [['Customer', L.customerName(r.customerId)], ['Amount received', U.money(r.amount)], ['Paid by', L.PAY[r.method]]];
    }
    rows = rows.concat([[type === 'sale' || type === 'payment' || type === 'adjustment' ? 'Date and time' : 'Date', type === 'sale' || type === 'payment' || type === 'adjustment' ? U.fmtDateTime(r.ts) : U.fmtDate(r.date)], ['Recorded by', L.userName(r.userId)], ['Note', r.note]]);
    var m = UI.modal({ title: t.label, body: UI.dl(rows),
      actions: owner ? [
        { label: 'Delete', kind: 'danger', icon: 'trash', left: true, onClick: function () {
          UI.confirm({ title: 'Delete this ' + t.label.toLowerCase() + '?', message: d.title + ' · ' + d.amountText + ' · ' + U.fmtDate(r.date),
            detail: type === 'delivery' ? 'Stock and the average cost will be recalculated. The deletion is kept in the audit log.' : 'This cannot be undone. The deletion is kept in the audit log.', confirmLabel: 'Delete', danger: true })
            .then(function (ok) { if (ok) return L.deleteEntry(type, r, me()).then(function () { m.close(); saved(t.label + ' deleted'); }); });
        } },
        { label: 'Edit', kind: 'primary', icon: 'edit', onClick: function () { m.close(); EDIT[type](r); } }
      ] : [{ label: 'Close', onClick: function (mm) { mm.close(); } }] });
  }

  return { product: product, delivery: delivery, adjustment: adjustment, expense: expense, recurring: recurring, categories: categories, customer: customer, payment: payment,
    pickCustomer: pickCustomer, sale: sale, detail: detail, payOptions: payOptions, prodOptions: prodOptions };
})();
