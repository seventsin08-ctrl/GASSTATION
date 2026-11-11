'use strict';
/* Screens: Inventory, Expenses, Reports, Customer accounts, Shifts, Settings. */

/** Hands a generated file to the user: Save to device or Share on Android, plain download in a browser. */
function deliverFile(file, title) {
  function report(r, okMsg) { if (r.ok) UI.toast(okMsg); else if (r.message !== 'cancelled') UI.toast('Could not finish: ' + r.message, 'err'); return r; }
  if (!Native.available) return Native.saveAs(file.name, file.mime, file.bytes).then(function (r) { return report(r, 'Downloaded ' + file.name); });
  return new Promise(function (res) {
    var m = UI.modal({ title: title || 'Export', size: 'narrow', onClose: function () { res(null); }, body: h('div.stack',
      h('p.muted.small.b', { style: { wordBreak: 'break-all' } }, file.name),
      h('button.btn.primary.block', { type: 'button', onclick: function () { m.close(); Native.saveAs(file.name, file.mime, file.bytes).then(function (r) { report(r, 'Saved ' + r.message); }); } }, U.icon('download', 18), 'Save to device'),
      h('button.btn.accent.block', { type: 'button', onclick: function () { m.close(); Native.share(file.name, file.mime, file.bytes).then(function (r) { if (!r.ok) report(r, ''); }); } }, U.icon('share', 18), 'Share with another app')) });
  });
}

// ====================================================================== Inventory
(function () {
  var st = { tab: 'stock', archived: false };

  function productCard(p, owner) {
    var stock = L.stockOf(p.id), low = L.isLow(p), me = App.user();
    return h('div.card.' + (p.color || 'sky'), { 'data-product-card': p.name, style: { opacity: p.archived ? '.6' : '' } },
      h('div.row', { style: { alignItems: 'flex-start' } }, UI.tank(p, stock),
        h('div.grow', { style: { marginLeft: '16px' } },
          h('div.row.between', h('h3.ell', { style: { fontSize: '18px' } }, p.name), p.archived ? h('span.chip', 'Archived') : low ? h('span.chip.low', U.icon('alert', 13), 'Low stock') : null),
          h('div.num', { 'data-out': 'stock', style: { fontSize: '26px', fontWeight: '800', letterSpacing: '-.02em', marginTop: '6px' } }, U.qty(stock, p.unit)),
          h('div.small.b', { style: { opacity: '.72' } }, (p.capacity > 0 ? 'of ' + U.qty(p.capacity, p.unit) : 'No capacity set') + (p.reorderLevel > 0 ? ' · reorder at ' + U.qty(p.reorderLevel, p.unit) : '')),
          h('div.small.b', { style: { marginTop: '8px' } }, p.price > 0 ? 'Price ' + U.money(p.price) + ' / ' + U.unitLabel(p.unit) : h('span.neg', 'No selling price yet')),
          owner ? h('div.small.b', { 'data-out': 'cost', style: { opacity: '.72' } }, 'Cost ₱' + U.num(p.cost || 0, 4) + ' · Value ' + U.money(Math.max(0, stock) * (p.cost || 0))) : null)),
      owner ? h('div.row', { style: { marginTop: '16px' } },
        p.archived ? null : h('button.btn.sm.primary.grow', { type: 'button', onclick: function () { Forms.delivery(null, p.id); } }, U.icon('truck', 16), 'Delivery'),
        p.archived ? null : h('button.btn.sm.grow', { type: 'button', onclick: function () { Forms.adjustment(null, p.id); } }, U.icon('adjust', 16), 'Adjust'),
        h('button.btn.sm.grow', { type: 'button', onclick: function () { Forms.product(p); } }, U.icon('edit', 16), 'Edit')) : null);
  }
  function entryList(type, emptyText) {
    var rows = L.entries({ type: type });
    if (!rows.length) return UI.empty(L.TYPES[type].icon, emptyText, '');
    return h('div.card.list', { style: { padding: '8px 16px' } }, rows.slice(0, 150).map(function (d) {
      return UI.item({ icon: d.icon, tone: d.tone, title: d.title, sub: d.sub, right: d.amountText, rightSub: U.fmtDate(d.rec.date) + ' · ' + L.userName(d.rec.userId), cls: d.qtyOnly ? (d.sign < 0 ? 'neg' : 'pos') : '' },
        function () { Forms.detail(d.type, d.rec); });
    }));
  }

  App.view('inventory', {
    render: function (root) {
      var owner = App.isOwner();
      if (!owner) st.tab = 'stock';
      if (owner) {
        root.appendChild(h('div.toolbar',
          UI.pills([{ value: 'stock', label: 'Tanks and stock' }, { value: 'deliveries', label: 'Deliveries' }, { value: 'adjustments', label: 'Adjustments' }, { value: 'prices', label: 'Price history' }], st.tab, function (v) { st.tab = v; App.refresh(true); }),
          h('span.grow'),
          st.tab === 'stock' ? h('button.btn.sm.primary', { type: 'button', 'data-act': 'add-product', onclick: function () { Forms.product(null); } }, U.icon('plus', 16), 'Add product') : null,
          st.tab === 'stock' || st.tab === 'deliveries' ? h('button.btn.sm.accent', { type: 'button', 'data-act': 'add-delivery', onclick: function () { Forms.delivery(null); } }, U.icon('truck', 16), 'Record delivery') : null,
          st.tab === 'adjustments' ? h('button.btn.sm.accent', { type: 'button', 'data-act': 'add-adjustment', onclick: function () { Forms.adjustment(null); } }, U.icon('adjust', 16), 'Adjust stock') : null));
      }
      if (st.tab === 'stock') {
        var list = L.products(st.archived), low = L.lowStock();
        if (low.length) root.appendChild(h('div.banner.neg', { style: { marginBottom: '14px' } }, U.icon('alert', 18), h('span', 'Low stock — time to reorder: ' + low.map(function (p) { return p.name; }).join(', '))));
        if (!list.length) root.appendChild(UI.empty('tank', 'No products yet', owner ? 'Add your fuels (sold per litre) and items (sold per piece).' : 'Ask the Owner to add products.'));
        else root.appendChild(h('div.grid.cards', list.map(function (p) { return productCard(p, owner); })));
        if (owner) {
          root.appendChild(h('div.row.between', { style: { marginTop: '16px' } },
            h('span.small.b.muted', 'Total stock value at cost: ' + U.money(L.stockValue())),
            DB.data.products.some(function (p) { return p.archived; }) ? h('button.link', { type: 'button', onclick: function () { st.archived = !st.archived; App.refresh(); } }, st.archived ? 'Hide archived products' : 'Show archived products') : null));
        }
      } else if (st.tab === 'deliveries') root.appendChild(entryList('delivery', 'No deliveries recorded yet'));
      else if (st.tab === 'adjustments') root.appendChild(entryList('adjustment', 'No stock adjustments yet'));
      else {
        var hist = DB.data.priceHistory.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 300);
        root.appendChild(h('p.muted.small.b', { style: { marginBottom: '10px' } }, 'Every price and cost change is kept here. Past sales always keep the price and cost they were sold at.'));
        root.appendChild(UI.table([{ label: 'Date', type: 'text' }, { label: 'Product', type: 'text' }, { label: 'Selling price', type: 'money' }, { label: 'Cost per unit', type: 'cost' }, { label: 'Reason', type: 'text' }, { label: 'Changed by', type: 'text' }],
          hist.map(function (x) { return [U.fmtDateTime(x.ts), L.productName(x.productId), x.price, x.cost, x.reason.charAt(0).toUpperCase() + x.reason.slice(1), L.userName(x.userId)]; })));
      }
    }
  });
})();

// ====================================================================== Expenses
(function () {
  var st = { tab: 'list', month: U.monthOf(U.today()) };
  App.view('expenses', {
    render: function (root) {
      root.appendChild(h('div.toolbar',
        UI.pills([{ value: 'list', label: 'Expenses' }, { value: 'recurring', label: 'Recurring monthly' }], st.tab, function (v) { st.tab = v; App.refresh(true); }),
        h('span.grow'),
        h('button.btn.sm', { type: 'button', onclick: Forms.categories }, U.icon('tag', 16), 'Categories'),
        st.tab === 'list' ? h('button.btn.sm.primary', { type: 'button', 'data-act': 'add-expense', onclick: function () { Forms.expense(null); } }, U.icon('plus', 16), 'Add expense')
          : h('button.btn.sm.primary', { type: 'button', 'data-act': 'add-recurring', onclick: function () { Forms.recurring(null); } }, U.icon('plus', 16), 'Add recurring')));
      if (st.tab === 'recurring') {
        var rec = DB.data.recurring.slice().sort(function (a, b) { return a.day - b.day; });
        if (!rec.length) return root.appendChild(UI.empty('repeat', 'No recurring expenses', 'Add rent, salaries or other bills that repeat every month. They are entered for you automatically.'));
        root.appendChild(h('div.card.list', { style: { padding: '8px 16px' } }, rec.map(function (r) {
          return UI.item({ icon: 'repeat', tone: 'cream', title: L.catName(r.categoryId) + (r.note ? ' · ' + r.note : ''),
            sub: 'Every month on day ' + r.day + (r.active ? ' · next on ' + U.fmtDate(L.nextRecurringDate(r)) : ' · paused'), right: U.money(r.amount), rightSub: r.active ? 'Active' : 'Paused' }, function () { Forms.recurring(r); });
        })));
        root.appendChild(h('p.small.muted.b', { style: { marginTop: '12px' } }, 'Total each month: ' + U.money(U.sum(rec.filter(function (r) { return r.active; }), function (r) { return r.amount; }))));
        return;
      }
      var from = st.month + '-01', to = U.monthEnd(from), s = L.summary(from, to);
      var rows = L.entries({ type: 'expense', from: from, to: to });
      root.appendChild(h('div.row', { style: { marginBottom: '14px' } },
        h('button.iconbtn', { type: 'button', 'aria-label': 'Previous month', onclick: function () { st.month = U.addMonths(st.month, -1); App.refresh(); } }, U.icon('back')),
        h('div.b', { style: { fontSize: '17px', minWidth: '120px', textAlign: 'center' } }, U.fmtMonth(st.month)),
        h('button.iconbtn', { type: 'button', 'aria-label': 'Next month', onclick: function () { st.month = U.addMonths(st.month, 1); App.refresh(); } }, U.icon('right'))));
      root.appendChild(h('div.grid.dash',
        h('div.card.cream.c4', h('div.kpi', h('div.lbl', U.icon('expense', 16), 'Overhead in ' + U.fmtMonth(st.month)), h('b', { 'data-out': 'overhead', style: { fontSize: '30px' } }, U.money(s.overhead)), h('div.sub', rows.length + (rows.length === 1 ? ' expense' : ' expenses')))),
        h('div.card.c8', h('div.cardhead', h('h3', 'By category')), s.byCategory.length ? UI.donut(s.byCategory.map(function (c) { return { label: c.name, value: c.amount }; }), 'Overhead') : h('p.muted.small', 'No expenses this month.'))));
      root.appendChild(h('div.sect', { style: { marginTop: '18px' } }, 'Expenses'));
      if (!rows.length) root.appendChild(UI.empty('expense', 'No expenses in ' + U.fmtMonth(st.month), 'Add salaries, electricity, rent and other overhead here.'));
      else root.appendChild(h('div.card.list', { style: { padding: '8px 16px' } }, rows.map(function (d) {
        return UI.item({ icon: d.rec.recurringId ? 'repeat' : d.icon, tone: d.tone, title: d.title, sub: d.sub, right: d.amountText, rightSub: U.fmtDateShort(d.rec.date) + ' · ' + L.userName(d.rec.userId) }, function () { Forms.detail('expense', d.rec); });
      })));
    }
  });
})();

// ====================================================================== Reports
(function () {
  var st = { id: 'daily', preset: 'month', from: U.monthStart(U.today()), to: U.today() };
  App.view('reports', {
    render: function (root) {
      var def = L.REPORTS.filter(function (r) { return r.id === st.id; })[0], r = Period.range(st), report = def.run(r.from, r.to), me = App.user(), s = Settings.get();
      function exportAs(fmt) {
        try {
          var file = Exporter.make(report, fmt, { stationName: s.stationName, address: s.address, logo: s.logo, by: me.displayName || me.username }, r.from, r.to);
          deliverFile(file, 'Export ' + Exporter.FORMATS[fmt].label);
        } catch (e) { UI.toast('Could not create the file: ' + e.message, 'err'); }
      }
      root.appendChild(h('div.toolbar', UI.pills(L.REPORTS.map(function (x) { return { value: x.id, label: x.name }; }), st.id, function (v) { st.id = v; App.refresh(true); })));
      var sel = UI.select(Period.options(['today', 'yesterday', '7d', 'month', 'lastmonth', 'year', 'custom']), st.preset, function (v) { st.preset = v; App.refresh(); }, 'sm');
      sel.setAttribute('aria-label', 'Period'); sel.style.maxWidth = '200px';
      root.appendChild(h('div.toolbar', sel, st.preset === 'custom' ? Period.dates(st, App.refresh) : null, h('span.grow'),
        h('button.btn.sm.primary', { type: 'button', 'data-export': 'pdf', onclick: function () { exportAs('pdf'); } }, U.icon('file', 16), 'PDF'),
        h('button.btn.sm.accent', { type: 'button', 'data-export': 'xlsx', onclick: function () { exportAs('xlsx'); } }, U.icon('sheet', 16), 'Excel'),
        h('button.btn.sm', { type: 'button', 'data-export': 'csv', onclick: function () { exportAs('csv'); } }, U.icon('download', 16), 'CSV')));
      root.appendChild(h('p.muted.small.b', { style: { marginBottom: '6px' } }, def.hint + ' · ' + report.period));
      report.sections.forEach(function (sec) {
        root.appendChild(h('div.sect', { style: { marginTop: '14px' } }, sec.name));
        root.appendChild(UI.table(sec.columns, sec.rows, sec.totals));
      });
    }
  });
})();

// ====================================================================== Customer accounts
(function () {
  function openCustomer(c) {
    var me = App.user(), bal = L.balanceOf(c.id), ledger = [];
    DB.data.sales.forEach(function (s) { if (s.customerId === c.id && s.payment === 'credit') ledger.push(L.describe('sale', s)); });
    DB.data.payments.forEach(function (p) { if (p.customerId === c.id) ledger.push(L.describe('payment', p)); });
    ledger.sort(function (a, b) { return b.rec.ts - a.rec.ts; });
    var m = UI.modal({ title: c.name, body: h('div.stack',
      h('div.card.' + (bal > 0 ? 'peach' : 'mint'), h('div.kpi', h('div.lbl', 'Balance owed'), h('b', { style: { fontSize: '30px' } }, U.money(bal)), h('div.sub', (c.phone ? c.phone + ' · ' : '') + (c.note || 'Customer account')))),
      h('div.row', h('button.btn.primary.grow', { type: 'button', onclick: function () { m.close(); Forms.payment(null, c.id); } }, U.icon('cash', 18), 'Record payment'),
        h('button.btn', { type: 'button', onclick: function () { m.close(); Forms.customer(c); } }, U.icon('edit', 18), 'Edit')),
      ledger.length ? h('div.list', ledger.slice(0, 60).map(function (d) {
        return UI.item({ icon: d.icon, tone: d.tone, title: d.type === 'sale' ? d.title : 'Payment received', sub: U.fmtDateTime(d.rec.ts), right: (d.type === 'sale' ? '+' : '−') + d.amountText, cls: d.type === 'sale' ? '' : 'pos' }, function () { m.close(); Forms.detail(d.type, d.rec); });
      })) : h('p.muted.small', 'No credit sales or payments yet.'),
      h('button.link', { type: 'button', onclick: function () {
        (c.archived ? Promise.resolve(true) : UI.confirm({ title: 'Archive ' + c.name + '?', message: 'The account is hidden from the credit list. Its history stays in your records.', confirmLabel: 'Archive', danger: true }))
          .then(function (ok) { if (ok) return L.archiveCustomer(c, !c.archived, me).then(function () { m.close(); App.refresh(); }); });
      } }, c.archived ? 'Restore this account' : 'Archive this account')) });
  }
  App.view('customers', {
    render: function (root) {
      var list = L.customers(true), total = U.sum(list, function (c) { return Math.max(0, L.balanceOf(c.id)); });
      root.appendChild(h('div.toolbar', h('span.chip.warnc', { 'data-out': 'receivable' }, 'Total owed to you: ' + U.money(total)), h('span.grow'),
        h('button.btn.sm.primary', { type: 'button', 'data-act': 'add-customer', onclick: function () { Forms.customer(null); } }, U.icon('plus', 16), 'Add customer')));
      if (!list.length) return root.appendChild(UI.empty('credit', 'No customer accounts', 'Add customers who buy on credit. Their sales and payments are tracked here.'));
      root.appendChild(h('div.card.list', { style: { padding: '8px 16px' } }, list.map(function (c) {
        var bal = L.balanceOf(c.id);
        return UI.item({ icon: 'user', tone: 'lav', title: c.name + (c.archived ? ' (archived)' : ''), sub: c.phone || c.note || 'Customer account', right: U.money(bal), rightSub: bal > 0 ? 'owes' : 'settled', cls: bal > 0 ? '' : 'muted' }, function () { openCustomer(c); });
      })));
    }
  });
})();

// ====================================================================== Shifts
(function () {
  function variance(s) { return s.closedAt ? U.round(s.actualCash - s.expectedCash, 2) : null; }
  function shiftDetail(s) {
    var stt = L.shiftStats(s), owner = App.isOwner(), v = variance(s);
    var m = UI.modal({ title: 'Shift · ' + L.userName(s.userId), size: 'wide', body: h('div.stack',
      s.closedAt ? h('div.card.' + (v === 0 ? 'mint' : v > 0 ? 'sky' : 'peach'), h('div.kpi', h('div.lbl', 'Cash ' + (v === 0 ? 'balanced' : v > 0 ? 'over' : 'short')), h('b', { 'data-out': 'variance', style: { fontSize: '30px' } }, (v > 0 ? '+' : '') + U.money(v)),
        h('div.sub', 'Expected ' + U.money(s.expectedCash) + ' · counted ' + U.money(s.actualCash)))) : h('div.banner.info', U.icon('clock', 18), h('span', 'This shift is still open.')),
      UI.dl([['Opened', U.fmtDateTime(s.openedAt)], ['Closed', s.closedAt ? U.fmtDateTime(s.closedAt) : 'Still open'], ['Sales recorded', U.num(stt.count, 0) + ' · ' + U.money(stt.total)],
        ['Opening cash', U.money(s.openingCash)], ['Cash sales', U.money(stt.cash)], stt.payCash ? ['Cash payments on account', U.money(stt.payCash)] : null,
        s.closedAt ? ['Expected cash', U.money(stt.expectedCash)] : null, s.closedAt ? ['Cash counted', U.money(s.actualCash)] : null,
        ['GCash sales', U.money(stt.gcash)], ['Card sales', U.money(stt.card)], ['Credit sales', U.money(stt.credit)], ['Note', s.note]]),
      stt.meters.length ? h('div', h('div.sect', { style: { fontSize: '16px' } }, 'Pump meters (litres)'),
        UI.table([{ label: 'Product' }, { label: 'Opening', type: 'qty' }, { label: 'Closing', type: 'qty' }, { label: 'Metered', type: 'qty' }, { label: 'Recorded sales', type: 'qty' }, { label: 'Difference', type: 'qty' }],
          stt.meters.map(function (x) { return [L.productName(x.productId), x.open, x.close, x.metered, x.recorded, x.variance]; }))) : null),
      actions: (owner ? [{ label: 'Delete', kind: 'danger', icon: 'trash', left: true, onClick: function () {
        UI.confirm({ title: 'Delete this shift record?', message: 'The sales made during the shift are kept. Only the shift record (meter readings and cash count) is removed.', confirmLabel: 'Delete', danger: true })
          .then(function (ok) { if (ok) return L.deleteShift(s, App.user()).then(function () { m.close(); UI.toast('Shift deleted'); App.refresh(); }); });
      } }] : []).concat([{ label: 'Close', onClick: function (mm) { mm.close(); } }]) });
  }
  function startShift() {
    var fuels = L.fuelProducts(), me = App.user();
    UI.form({ title: 'Start shift', intro: 'Count the cash in the drawer and read each pump meter before you start selling.',
      fields: [{ key: 'openingCash', label: 'Opening cash in drawer', type: 'money', value: 0, full: true }].concat(fuels.map(function (p) {
        return { key: 'm_' + p.id, label: p.name + ' — opening meter', type: 'qty', decimals: 3, suffix: 'L', value: L.lastMeter(p.id), hint: L.lastMeter(p.id) != null ? 'Filled in from the last closing reading.' : '' };
      })),
      submit: 'Start shift',
      onSubmit: function (v) {
        return L.openShift({ openingCash: v.openingCash == null ? 0 : v.openingCash, meters: fuels.map(function (p) { return { productId: p.id, open: v['m_' + p.id] }; }) }, me).then(function () { UI.toast('Shift started'); App.refresh(); });
      } });
  }
  function endShift(s) {
    var me = App.user();
    UI.form({ title: 'Close shift', intro: 'Read each pump meter again and count the cash in the drawer. The app then shows expected against actual cash.',
      fields: (s.meters || []).map(function (m) { return { key: 'm_' + m.productId, label: L.productName(m.productId) + ' — closing meter', type: 'qty', decimals: 3, suffix: 'L', hint: 'Opening reading: ' + U.num(m.open, 3, true) }; })
        .concat([{ key: 'actualCash', label: 'Cash counted in drawer', type: 'money', full: true }, { key: 'note', label: 'Note (optional)', type: 'textarea' }]),
      submit: 'Close shift',
      onSubmit: function (v) {
        var meters = {};
        (s.meters || []).forEach(function (m) { meters[m.productId] = v['m_' + m.productId]; });
        return L.closeShift(s, { actualCash: v.actualCash, meters: meters, note: v.note }, me).then(function () { App.refresh(); shiftDetail(s); });
      } });
  }
  App.view('shifts', {
    render: function (root) {
      var me = App.user(), owner = App.isOwner(), cur = L.currentShift(me.id);
      if (cur) {
        var stt = L.shiftStats(cur);
        root.appendChild(h('div.card.sky', h('div.row.between', { style: { alignItems: 'flex-start' } },
          h('div.kpi', h('div.lbl', U.icon('clock', 16), 'My shift · open since ' + U.fmtDateTime(cur.openedAt)), h('b', { style: { fontSize: '30px' } }, U.money(stt.total)),
            h('div.sub', U.num(stt.count, 0) + ' sales · cash ' + U.money(stt.cash) + ' · GCash ' + U.money(stt.gcash) + ' · card ' + U.money(stt.card) + ' · credit ' + U.money(stt.credit))),
          h('button.btn.primary', { type: 'button', 'data-act': 'close-shift', onclick: function () { endShift(cur); } }, 'Close shift'))));
      } else {
        root.appendChild(h('div.card.sky', h('div.row.between', h('div.kpi', h('div.lbl', U.icon('clock', 16), 'Shift tracking (optional)'), h('div.b', { style: { fontSize: '17px', marginTop: '6px' } }, 'No shift open'),
          h('div.sub', 'Start a shift to compare pump meter readings and drawer cash with recorded sales.')), h('button.btn.primary', { type: 'button', 'data-act': 'start-shift', onclick: startShift }, 'Start shift'))));
      }
      var list = DB.data.shifts.filter(function (s) { return owner || s.userId === me.id; }).sort(function (a, b) { return b.openedAt - a.openedAt; });
      root.appendChild(h('div.sect', { style: { marginTop: '18px' } }, owner ? 'All shifts' : 'My shifts'));
      if (!list.length) return root.appendChild(UI.empty('clock', 'No shifts yet', ''));
      root.appendChild(h('div.card.list', { style: { padding: '8px 16px' } }, list.slice(0, 120).map(function (s) {
        var v = variance(s), stt = L.shiftStats(s);
        return UI.item({ icon: 'clock', tone: s.closedAt ? 'lav' : 'sky', title: L.userName(s.userId) + ' · ' + U.fmtDate(U.dateStr(new Date(s.openedAt))),
          sub: U.fmtTime(s.openedAt) + ' – ' + (s.closedAt ? U.fmtTime(s.closedAt) : 'open') + ' · ' + stt.count + ' sales · ' + U.money(stt.total),
          right: v == null ? 'Open' : (v > 0 ? '+' : '') + U.money(v), rightSub: v == null ? '' : v === 0 ? 'balanced' : v > 0 ? 'over' : 'short', cls: v == null || v === 0 ? '' : v > 0 ? 'pos' : 'neg' }, function () { shiftDetail(s); });
      })));
    }
  });
})();

// ====================================================================== Settings
(function () {
  function me() { return App.user(); }
  function activeOwners(exceptId) { return DB.data.users.filter(function (u) { return u.role === 'owner' && !u.disabled && u.id !== exceptId; }).length; }
  var roleOpts = [{ value: 'cashier', label: 'Cashier' }, { value: 'owner', label: 'Owner' }];

  function addUser() {
    UI.form({ title: 'Add user', submit: 'Add user',
      fields: [{ key: 'displayName', label: 'Name', caps: 'words', placeholder: 'e.g. Maria Santos' }, { key: 'username', label: 'Username', caps: 'none', placeholder: 'e.g. maria' },
        { key: 'role', label: 'Role', type: 'seg', options: roleOpts, value: 'cashier', hint: 'Cashiers can only record sales. They cannot see profit, change prices or delete entries.' },
        { key: 'pw', label: 'Password', type: 'password', hint: 'At least 6 characters' }, { key: 'pw2', label: 'Confirm password', type: 'password' }],
      onSubmit: function (v) {
        var username = (v.username || '').trim();
        App.checkUserInput(username, v.pw, v.pw2, null);
        return Crypt.hashPassword(v.pw).then(function (hp) {
          var u = { id: U.uid(), username: username, displayName: (v.displayName || '').trim() || username, role: v.role === 'owner' ? 'owner' : 'cashier', salt: hp.salt, hash: hp.hash, iter: hp.iter, disabled: false, createdAt: Date.now(), createdBy: me().id };
          return DB.put('users', u).then(function () { return L.audit(me(), 'create', 'user', u.id, 'Added ' + (u.role === 'owner' ? 'Owner' : 'Cashier') + ' account ' + u.username); });
        }).then(function () { UI.toast('User added'); App.refresh(); });
      } });
  }
  function editUser(u) {
    var self = u.id === me().id;
    var m = UI.modal({ title: u.displayName || u.username, size: 'narrow', body: h('div.stack',
      h('div.row', h('span.chip', u.role === 'owner' ? 'Owner' : 'Cashier'), h('span.muted.small', '@' + u.username), u.disabled ? h('span.chip.low', 'Disabled') : null),
      h('button.btn.block', { type: 'button', onclick: function () {
        m.close();
        UI.form({ title: 'Edit user', columns: 1, fields: [{ key: 'displayName', label: 'Name', value: u.displayName, caps: 'words' }, { key: 'role', label: 'Role', type: 'seg', options: roleOpts, value: u.role }],
          onSubmit: function (v) {
            if (u.role === 'owner' && v.role !== 'owner' && !activeOwners(u.id)) throw new Error('There must be at least one active Owner.');
            var old = u.role; u.displayName = (v.displayName || '').trim() || u.username; u.role = v.role === 'owner' ? 'owner' : 'cashier';
            return DB.put('users', u).then(function () { return L.audit(me(), 'edit', 'user', u.id, 'Edited user ' + u.username + (old !== u.role ? ' — role: ' + old + ' → ' + u.role : '')); })
              .then(function () { if (self && u.role !== 'owner') { App.logout('Your role changed. Sign in again.'); } else { UI.toast('User saved'); App.refresh(); } });
          } });
      } }, U.icon('edit', 18), 'Edit name and role'),
      h('button.btn.block', { type: 'button', onclick: function () {
        m.close();
        if (self) return App.changePassword();
        UI.form({ title: 'Reset password for ' + u.username, columns: 1, submit: 'Reset password', fields: [{ key: 'pw', label: 'New password', type: 'password', hint: 'At least 6 characters. Tell the user their new password.' }, { key: 'pw2', label: 'Confirm new password', type: 'password' }],
          onSubmit: function (v) {
            App.checkUserInput(null, v.pw, v.pw2);
            return Crypt.hashPassword(v.pw).then(function (hp) { u.salt = hp.salt; u.hash = hp.hash; u.iter = hp.iter; return DB.put('users', u); })
              .then(function () { return L.audit(me(), 'edit', 'user', u.id, 'Reset password for ' + u.username); }).then(function () { UI.toast('Password reset'); });
          } });
      } }, U.icon('key', 18), self ? 'Change my password' : 'Reset password'),
      self ? null : h('button.btn.block' + (u.disabled ? '.accent' : '.danger'), { type: 'button', onclick: function () {
        if (!u.disabled && u.role === 'owner' && !activeOwners(u.id)) return UI.toast('There must be at least one active Owner.', 'err');
        (u.disabled ? Promise.resolve(true) : UI.confirm({ title: 'Disable ' + u.username + '?', message: 'They will not be able to sign in. Their past entries stay in your records. You can enable the account again later.', confirmLabel: 'Disable', danger: true }))
          .then(function (ok) {
            if (!ok) return;
            u.disabled = !u.disabled;
            return DB.put('users', u).then(function () { return L.audit(me(), 'edit', 'user', u.id, (u.disabled ? 'Disabled' : 'Enabled') + ' user ' + u.username); }).then(function () { m.close(); UI.toast(u.disabled ? 'User disabled' : 'User enabled'); App.refresh(); });
          });
      } }, U.icon(u.disabled ? 'check' : 'lock', 18), u.disabled ? 'Enable account' : 'Disable account')) });
  }

  function editStation() {
    var s = Settings.get();
    UI.form({ title: 'Station details', columns: 1, intro: 'Shown on the sign-in screen and at the top of exported reports.',
      fields: [{ key: 'stationName', label: 'Station name', value: s.stationName, caps: 'words' }, { key: 'address', label: 'Address', type: 'textarea', value: s.address, placeholder: 'Street, barangay, city' }],
      onSubmit: function (v) {
        if (!v.stationName.trim()) throw new Error('Enter the station name.');
        return Settings.save({ stationName: v.stationName.trim(), address: v.address.trim().replace(/\s*\n\s*/g, ', ') }).then(function () { return L.audit(me(), 'edit', 'settings', '', 'Changed station details'); }).then(function () { UI.toast('Station details saved'); App.refresh(); });
      } });
  }
  function chooseLogo() {
    App.pickFile('image/*', function (file) {
      var r = new FileReader();
      r.onload = function () {
        var img = new Image();
        img.onerror = function () { UI.toast('That file is not an image the app can read.', 'err'); };
        img.onload = function () {
          var k = Math.min(1, 480 / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), hh = Math.max(1, Math.round(img.height * k));
          var c = document.createElement('canvas'); c.width = w; c.height = hh;
          var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); ctx.drawImage(img, 0, 0, w, hh);
          Settings.save({ logo: { dataUrl: c.toDataURL('image/jpeg', 0.9), w: w, h: hh } }).then(function () { UI.toast('Logo saved'); App.refresh(); });
        };
        img.src = String(r.result);
      };
      r.readAsDataURL(file);
    });
  }

  function exportBackup() {
    var file = { name: Backup.fileName(), mime: 'application/json', bytes: Backup.bytes(me().username) };
    var before = Settings.get().lastBackupAt;
    function mark(r) { if (r && r.ok) return Settings.save({ lastBackupAt: Date.now() }).then(function () { return L.audit(me(), 'backup', 'backup', '', 'Exported backup ' + file.name); }).then(App.refresh); }
    if (!Native.available) return Native.saveAs(file.name, file.mime, file.bytes).then(function (r) { UI.toast('Backup downloaded'); return mark(r); });
    var m = UI.modal({ title: 'Export backup', size: 'narrow', body: h('div.stack',
      h('p.muted.small.b', 'One file with everything: users, products, sales, deliveries, expenses and settings.'),
      h('button.btn.primary.block', { type: 'button', onclick: function () { m.close(); Native.saveAs(file.name, file.mime, file.bytes).then(function (r) { if (r.ok) UI.toast('Backup saved: ' + r.message); else if (r.message !== 'cancelled') UI.toast('Could not save: ' + r.message, 'err'); return mark(r); }); } }, U.icon('download', 18), 'Save to device storage'),
      h('button.btn.accent.block', { type: 'button', onclick: function () { m.close(); Native.share(file.name, file.mime, file.bytes).then(function (r) { if (!r.ok) UI.toast('Could not share: ' + r.message, 'err'); return mark(r); }); } }, U.icon('share', 18), 'Share with another app')) });
    return before;
  }
  function backupToFolderNow() {
    Native.toBackupFolder(Backup.fileName(), Backup.bytes(me().username)).then(function (r) {
      if (!r.ok) return UI.toast('Backup failed: ' + r.message, 'err');
      return Settings.save({ lastBackupAt: Date.now() }).then(function () { UI.toast('Backup saved in ' + r.message); App.refresh(); });
    });
  }

  function auditLog() {
    var q = '', limit = 100, host = h('div.list'), LABEL = { create: 'Added', edit: 'Edited', 'delete': 'Deleted', archive: 'Archived', restore: 'Restored', backup: 'Backup' };
    function draw() {
      U.clear(host);
      var rows = DB.data.audit.filter(function (a) { return !q || (a.summary + ' ' + L.userName(a.userId) + ' ' + a.entity).toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return b.ts - a.ts; });
      if (!rows.length) return host.appendChild(UI.empty('shield', 'No audit entries', 'Edits, deletions and account changes are listed here.'));
      rows.slice(0, limit).forEach(function (a) {
        host.appendChild(h('div.item', { style: { alignItems: 'flex-start' } }, h('div.bubble.' + (a.action === 'delete' ? 'rose' : a.action === 'edit' ? 'cream' : 'sky'), U.icon(a.action === 'delete' ? 'trash' : a.action === 'edit' ? 'edit' : 'shield', 19)),
          h('div.grow', h('div.t', { style: { whiteSpace: 'normal', userSelect: 'text' } }, a.summary), h('div.s', U.fmtDateTime(a.ts) + ' · ' + L.userName(a.userId) + ' · ' + (LABEL[a.action] || a.action)))));
      });
      if (rows.length > limit) host.appendChild(h('div.center', h('button.btn.sm', { type: 'button', onclick: function () { limit += 200; draw(); } }, 'Show more (' + (rows.length - limit) + ' left)')));
    }
    draw();
    UI.modal({ title: 'Audit log', size: 'wide', body: h('div.stack', h('input.input', { type: 'search', placeholder: 'Search the audit log', oninput: function (e) { q = e.target.value.trim().toLowerCase(); limit = 100; draw(); } }), host) });
  }

  function card(title, icon, tone, children) { return h('div.card', { 'data-card': title }, h('div.cardhead', h('div.row', h('div.bubble.' + tone, U.icon(icon, 21)), h('h3', title))), h('div.stack', children)); }

  App.view('settings', {
    render: function (root) {
      var owner = App.isOwner(), s = Settings.get(), grid = h('div.grid.cards'), folder = Native.folder();
      if (owner) {
        grid.appendChild(card('Station', 'store', 'cream', [
          h('div.row', h('div.logo-prev', s.logo ? h('img', { src: s.logo.dataUrl, alt: 'Station logo' }) : U.icon('image', 26)),
            h('div.grow', h('div.b.ell', { 'data-out': 'station', style: { fontSize: '17px' } }, s.stationName), h('div.small.muted', s.address || 'No address yet'))),
          h('div.row.wrap', h('button.btn.sm.primary', { type: 'button', 'data-act': 'edit-station', onclick: editStation }, U.icon('edit', 16), 'Edit details'),
            h('button.btn.sm', { type: 'button', onclick: chooseLogo }, U.icon('image', 16), s.logo ? 'Change logo' : 'Add logo'),
            s.logo ? h('button.btn.sm', { type: 'button', onclick: function () { Settings.save({ logo: null }).then(App.refresh); } }, 'Remove logo') : null)]));
        grid.appendChild(card('Users', 'users', 'lav', [
          h('div.list', DB.data.users.map(function (u) {
            return UI.item({ icon: 'user', tone: u.role === 'owner' ? 'lav' : 'sky', title: (u.displayName || u.username) + (u.id === me().id ? ' (you)' : ''), sub: '@' + u.username, right: u.disabled ? 'Disabled' : u.role === 'owner' ? 'Owner' : 'Cashier', cls: u.disabled ? 'neg' : '' }, function () { editUser(u); });
          })),
          h('button.btn.sm.primary', { type: 'button', 'data-act': 'add-user', onclick: addUser }, U.icon('plus', 16), 'Add user')]));
        grid.appendChild(card('Backup and restore', 'database', 'mint', [
          h('p.small.b.muted', s.lastBackupAt ? 'Last backup: ' + U.fmtDateTime(s.lastBackupAt) : 'No backup made yet. Export one regularly and keep a copy off this device.'),
          h('div.row.wrap', h('button.btn.sm.primary', { type: 'button', 'data-act': 'export-backup', onclick: exportBackup }, U.icon('download', 16), 'Export backup'),
            h('button.btn.sm', { type: 'button', 'data-act': 'import-backup', onclick: App.importBackup }, U.icon('upload', 16), 'Import backup')),
          Native.available ? h('div.stack', { style: { paddingTop: '6px', borderTop: '1px solid var(--line)' } },
            h('div.row.between', h('div', h('div.b', 'Automatic daily backup'), h('div.small.muted', folder ? 'Folder: ' + folder + ' · keeps the last 30' : 'Choose a folder to turn this on')),
              h('button.switch' + (s.autoBackup && folder ? '.on' : ''), { type: 'button', 'aria-label': 'Automatic daily backup', onclick: function () {
                if (!folder) return UI.toast('Choose a backup folder first.', 'err');
                Settings.save({ autoBackup: !s.autoBackup }).then(App.refresh);
              } })),
            h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: function () {
              Native.pickFolder().then(function (r) {
                if (!r.ok) { if (r.message !== 'cancelled') UI.toast('Could not use that folder: ' + r.message, 'err'); return; }
                return Settings.save({ autoBackup: true, lastAutoBackup: '' }).then(function () { UI.toast('Daily backups will be saved in ' + r.message); App.refresh(); });
              });
            } }, U.icon('folder', 16), folder ? 'Change folder' : 'Choose folder'),
              folder ? h('button.btn.sm', { type: 'button', onclick: backupToFolderNow }, 'Back up now') : null,
              folder ? h('button.btn.sm', { type: 'button', onclick: function () { Native.clearFolder(); Settings.save({ autoBackup: false }).then(App.refresh); } }, 'Stop') : null))
            : h('p.small.muted', 'Automatic daily backup to a folder is available in the Android app.')]));
        grid.appendChild(card('Security', 'shield', 'sky', [
          h('label.field', h('span.lbl', 'Sign out automatically after no activity for'),
            UI.select([1, 2, 5, 10, 15, 30, 60].map(function (n) { return { value: n, label: n + (n === 1 ? ' minute' : ' minutes') }; }), s.autoLogoutMin, function (v) { Settings.save({ autoLogoutMin: +v }).then(function () { UI.toast('Saved'); }); })),
          h('div.row.wrap', h('button.btn.sm', { type: 'button', onclick: App.changePassword }, U.icon('key', 16), 'Change my password'),
            h('button.btn.sm', { type: 'button', 'data-act': 'audit', onclick: auditLog }, U.icon('history', 16), 'Audit log (' + U.num(DB.data.audit.length, 0) + ')'))]));
        grid.appendChild(card('Expense categories', 'tag', 'peach', [
          h('p.small.b.muted', L.categories(false).map(function (c) { return c.name; }).join(' · ')),
          h('div', h('button.btn.sm', { type: 'button', onclick: Forms.categories }, U.icon('edit', 16), 'Manage categories'))]));
      } else {
        grid.appendChild(card('My account', 'user', 'sky', [h('p.small.b.muted', 'Signed in as ' + (me().displayName || me().username) + ' (Cashier).'),
          h('div', h('button.btn.sm', { type: 'button', onclick: App.changePassword }, U.icon('key', 16), 'Change my password'))]));
      }
      grid.appendChild(card('Appearance', 'sun', 'cream', [
        UI.seg([{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'system', label: 'Auto' }], App.themePref(), App.setTheme),
        h('p.small.muted', 'Auto follows this device’s setting.')]));
      grid.appendChild(card('About', 'info', 'rose', [
        UI.dl([['App', 'Gas Station Manager'], ['Version', Native.version()], ['Data format', 'Version ' + Backup.VERSION], ['Storage', 'On this device only (offline)'],
          owner ? ['Records', U.num(DB.data.sales.length, 0) + ' sales · ' + U.num(DB.data.deliveries.length, 0) + ' deliveries · ' + U.num(DB.data.expenses.length, 0) + ' expenses'] : null]),
        h('div', h('button.btn.sm.primary', { type: 'button', onclick: function () { App.logout(); } }, U.icon('logout', 16), 'Sign out'))]));
      root.appendChild(grid);
    }
  });
})();
