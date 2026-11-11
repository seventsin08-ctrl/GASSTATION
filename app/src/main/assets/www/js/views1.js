'use strict';
/* Screens: Overview (dashboard), Sell, Transactions. */

var Period = (function () {
  var PRESETS = { today: 'Today', yesterday: 'Yesterday', '7d': 'Last 7 days', month: 'This month', lastmonth: 'Last month', year: 'This year', all: 'All time', custom: 'Custom dates' };
  function range(st) {
    var t = U.today();
    switch (st.preset) {
      case 'today': return { from: t, to: t };
      case 'yesterday': return { from: U.addDays(t, -1), to: U.addDays(t, -1) };
      case '7d': return { from: U.addDays(t, -6), to: t };
      case 'month': return { from: U.monthStart(t), to: t };
      case 'lastmonth': var lm = U.addMonths(U.monthOf(t), -1); return { from: lm + '-01', to: U.monthEnd(lm + '-01') };
      case 'year': return { from: t.slice(0, 4) + '-01-01', to: t };
      case 'all': return { from: '0000-01-01', to: '9999-12-31' };
      default:
        var f = st.from || t, to = st.to || t;
        return f <= to ? { from: f, to: to } : { from: to, to: f };
    }
  }
  /** Two date inputs for the custom range; calls onChange after either changes. */
  function dates(st, onChange) {
    function inp(key, label) {
      return h('input.input.sm', { type: 'date', 'aria-label': label, 'data-field': key, value: st[key] || U.today(), max: U.today(), style: { flex: 'none', width: '158px', minWidth: '0' },
        onchange: function (e) { if (e.target.value) { st[key] = e.target.value; onChange(); } } });
    }
    return [inp('from', 'From date'), h('span.muted.b', 'to'), inp('to', 'To date')];
  }
  function options(keys) { return keys.map(function (k) { return { value: k, label: PRESETS[k] }; }); }
  return { PRESETS: PRESETS, range: range, dates: dates, options: options };
})();

// ====================================================================== Overview
(function () {
  var st = { preset: 'today', from: U.today(), to: U.today() };

  function kpi(key, cls, icon, label, value, sub) {
    return h('div.card.kpi' + (cls ? '.' + cls : ''), { 'data-kpi': key }, h('div.lbl', U.icon(icon, 16), label), h('b', value), sub ? h('div.sub', sub) : null);
  }

  App.view('dashboard', {
    render: function (root) {
      var r = Period.range(st), s = L.summary(r.from, r.to), low = L.lowStock(), prods = L.products(false);
      var label = st.preset === 'custom' ? L.periodLabel(r.from, r.to) : Period.PRESETS[st.preset];
      App.setActions(low.length ? h('button.iconbtn', { type: 'button', 'aria-label': low.length + ' low stock warnings', onclick: function () { App.go('inventory'); } }, U.icon('alert'), h('span.dot')) : null);

      root.appendChild(h('div.toolbar', UI.pills(Period.options(['today', '7d', 'month', 'custom']), st.preset, function (v) { st.preset = v; App.refresh(); }),
        st.preset === 'custom' ? Period.dates(st, App.refresh) : null));

      if (low.length) {
        root.appendChild(h('button.banner.neg', { type: 'button', style: { width: '100%', marginBottom: '14px' }, onclick: function () { App.go('inventory'); } }, U.icon('alert', 18),
          h('span.grow', 'Low stock: ' + low.map(function (p) { return p.name + ' (' + U.qty(L.stockOf(p.id), p.unit) + ')'; }).join(', ')), U.icon('right', 18)));
      }
      if (!prods.some(function (p) { return p.price > 0; })) {
        root.appendChild(h('button.banner.info', { type: 'button', style: { width: '100%', marginBottom: '14px' }, onclick: function () { App.go('inventory'); } }, U.icon('info', 18),
          h('span.grow', 'Set your selling prices, costs and starting stock in Inventory to begin selling.'), U.icon('right', 18)));
      }

      var chartHost = h('div'), grid = h('div.grid.dash');
      grid.appendChild(h('div.card.sky.hero.c5', { 'data-kpi': 'net' },
        h('div.kpi', h('div.lbl', U.icon('trend', 16), 'Net profit · ' + label)),
        h('b.big' + (s.net < 0 ? '.neg' : ''), U.money(s.net)),
        h('div.formula', h('span', 'Sales ' + U.money(s.sales)), h('i', '−'), h('span', 'Cost of goods ' + U.money(s.cogs)), h('i', '−'), h('span', 'Overhead ' + U.money(s.overhead)))));
      grid.appendChild(h('div.grid.kpis.c7',
        kpi('sales', 'lav', 'cash', 'Total sales', U.money(s.sales), U.num(s.count, 0) + (s.count === 1 ? ' sale' : ' sales')),
        kpi('gross', 'mint', 'arrowup', 'Gross profit', U.money(s.gross), 'Sales − cost of goods'),
        kpi('overhead', 'cream', 'expense', 'Overhead', U.money(s.overhead), s.byCategory.length + (s.byCategory.length === 1 ? ' category' : ' categories'))));
      grid.appendChild(kpi('cogs', 'c3', 'box', 'Cost of goods sold', U.money(s.cogs)));
      grid.appendChild(kpi('litres', 'c3', 'drop', 'Litres sold', U.num(s.litres, 3, true) + ' L', s.pieces ? U.qty(s.pieces, 'pc') + ' of other items' : null));
      grid.appendChild(kpi('margin', 'c3', 'gauge', 'Gross margin', U.pct(s.margin), 'Gross profit ÷ sales'));
      grid.appendChild(kpi('stockvalue', 'c3', 'database', 'Stock value', U.money(L.stockValue()), 'On hand now, at cost'));

      grid.appendChild(h('div.card.c8', h('div.cardhead', h('h3', U.daysBetween(r.from, r.to) > 31 ? 'Monthly sales and profit' : 'Daily sales and profit'), h('span.chip', label)), chartHost));
      grid.appendChild(h('div.card.ink.c4', h('div.cardhead', h('h3', 'Tank levels'), h('button.btn.sm.accent', { type: 'button', onclick: function () { App.go('inventory'); } }, 'Manage')),
        prods.length ? prods.slice(0, 6).map(function (p) {
          var stock = L.stockOf(p.id), pct = p.capacity > 0 ? Math.max(0, Math.min(100, stock / p.capacity * 100)) : 0, lowp = L.isLow(p);
          return h('div', { style: { padding: '7px 0' } }, h('div.row.between.small.b', h('span.ell', p.name), h('span' + (lowp ? '.neg' : ''), { style: { whiteSpace: 'nowrap', color: lowp ? '#ff8b80' : '' } }, U.qty(stock, p.unit) + (lowp ? ' · low' : ''))),
            h('div.meter', { style: { marginTop: '6px', background: 'rgba(255,255,255,.14)' } }, h('i', { style: { width: pct + '%', background: lowp ? '#ff7b70' : '#a9d0f7' } })));
        }) : h('p.muted.small', 'No products yet.')));

      grid.appendChild(h('div.card.c6', h('div.cardhead', h('h3', 'Overhead by category'), h('span.chip', U.money(s.overhead))),
        s.byCategory.length ? UI.donut(s.byCategory.map(function (c) { return { label: c.name, value: c.amount }; }), 'Overhead') : UI.empty('expense', 'No expenses in this period', '')));
      grid.appendChild(h('div.card.c6', h('div.cardhead', h('h3', 'Gross profit by product'), h('span.chip', U.money(s.gross))),
        s.byProduct.length ? UI.hbars(s.byProduct.map(function (p) { return { label: p.name, value: p.profit, sub: U.qty(p.qty, p.unit) }; })) : UI.empty('sell', 'No sales in this period', '')));
      root.appendChild(grid);
      chartHost.appendChild(UI.barChart(L.series(r.from === '0000-01-01' ? U.today() : r.from, r.to), chartHost.clientWidth));
    }
  });
})();

// ====================================================================== Sell
(function () {
  var st = { pid: '', mode: 'qty', entry: '', pay: 'cash', customer: null };
  var PAY_ICON = { cash: 'cash', gcash: 'phone', card: 'card', credit: 'credit' };

  App.view('sell', {
    enter: function () { st.entry = ''; },
    render: function (root) {
      var owner = App.isOwner(), me = App.user(), prods = L.products(false);
      if (!L.product(st.pid) || L.product(st.pid).archived) st.pid = prods.length ? prods[0].id : '';
      var p = L.product(st.pid), unit = p ? p.unit : 'L';
      if (!prods.length) {
        root.appendChild(UI.empty('sell', 'No products to sell yet', owner ? 'Add your fuels and items in Inventory first.' : 'Ask the Owner to add products.',
          owner ? h('button.btn.primary', { type: 'button', onclick: function () { App.go('inventory'); } }, 'Go to Inventory') : null));
        return;
      }
      var dec = st.mode === 'amount' ? 2 : (unit === 'L' ? 3 : 0);
      var val = h('div.val'), cap = h('div.cap'), totals = h('div.totals'), saveBtn = h('button.btn.primary.lg.block', { type: 'button', 'data-act': 'save-sale', onclick: save });

      function calc() { return L.saleCalc(p, st.mode, parseFloat(st.entry) || 0); }
      function update() {
        var c = calc();
        UI.showEntry(val, st.entry, st.mode === 'amount' ? '₱' : '', st.mode === 'amount' ? '' : (unit === 'L' ? 'L' : 'pcs'));
        cap.textContent = st.mode === 'amount' ? 'Peso amount' : (unit === 'L' ? 'Litres' : 'Pieces');
        U.clear(totals);
        U.append(totals, [
          h('div.line', h('span', 'Quantity'), h('span', { 'data-out': 'qty' }, U.qty(c.qty, unit))),
          h('div.line', h('span', 'Price'), h('span', p.price > 0 ? U.money(p.price) + ' / ' + U.unitLabel(unit) : 'Not set')),
          owner ? h('div.line', h('span', 'Gross profit'), h('span' + (c.profit < 0 ? '.neg' : '.pos'), { 'data-out': 'profit' }, U.money(c.profit))) : null,
          h('div.line.total', h('span', 'Total'), h('span', { 'data-out': 'total' }, U.money(c.total))),
          c.exceeds ? h('div.banner', { style: { marginTop: '8px' } }, U.icon('alert', 18), h('span', 'More than the stock on hand (' + U.qty(c.stock, unit) + ').')) : null]);
        saveBtn.textContent = c.total > 0 ? 'Save sale · ' + U.money(c.total) : 'Save sale';
      }
      function onKey(k) { st.entry = UI.press(st.entry, k, dec); update(); }
      function save() {
        var c = calc();
        if (!(p.price > 0)) return UI.toast(owner ? 'Set a selling price for ' + p.name + ' in Inventory first.' : p.name + ' has no selling price yet. Ask the Owner.', 'err');
        if (!(c.qty > 0)) return UI.toast(st.mode === 'amount' ? (unit === 'L' ? 'Enter a peso amount.' : 'The amount is less than the price of one piece.') : 'Enter a quantity.', 'err');
        if (st.pay === 'credit' && !st.customer) return Forms.pickCustomer(function (cst) { st.customer = cst; App.refresh(); });
        saveBtn.disabled = true;
        (c.exceeds ? UI.confirm({ title: 'More than the stock on hand', message: 'The system shows only ' + U.qty(c.stock, unit) + ' of ' + p.name + ', but this sale is ' + U.qty(c.qty, unit) + '. Record it anyway?', confirmLabel: 'Record anyway' }) : Promise.resolve(true))
          .then(function (ok) {
            if (!ok) { saveBtn.disabled = false; return; }
            return L.addSale({ productId: p.id, mode: st.mode, input: parseFloat(st.entry), payment: st.pay, customerId: st.customer ? st.customer.id : '' }, me).then(function (s) {
              UI.toast('Saved · ' + p.name + ' ' + U.qty(s.qty, unit) + ' · ' + U.money(s.total));
              st.entry = ''; if (st.pay === 'credit') { st.pay = 'cash'; st.customer = null; }
              App.refresh();
            });
          }).catch(function (e) { saveBtn.disabled = false; UI.toast(e.message || String(e), 'err'); });
      }

      var quick = st.mode === 'amount' ? [100, 200, 300, 500, 1000] : (unit === 'L' ? [5, 10, 20, 30, 50] : [1, 2, 3, 4, 5]);
      var today = U.today(), mine = DB.data.sales.filter(function (s) { return s.date === today && (owner || s.userId === me.id); }).sort(function (a, b) { return b.ts - a.ts; });
      var sh = L.currentShift(me.id);

      var left = h('div.sa', h('div.sect', 'Choose product'), h('div.prodgrid', prods.map(function (x) {
          var stock = L.stockOf(x.id), pct = x.capacity > 0 ? Math.max(0, Math.min(100, stock / x.capacity * 100)) : 0, low = L.isLow(x);
          return h('button.prod.' + (x.color || 'sky') + (x.id === st.pid ? '.on' : ''), { type: 'button', 'data-product': x.name, onclick: function () { st.pid = x.id; st.entry = ''; if (x.unit !== 'L' && st.mode === 'amount') st.mode = 'qty'; App.refresh(); } },
            h('div.n', x.name), h('div.p', x.price > 0 ? U.money(x.price) : 'No price', h('small', ' / ' + U.unitLabel(x.unit))),
            h('div.st', low ? h('span.neg', 'Low · ') : null, U.qty(stock, x.unit) + ' left'), h('div.meter', h('i' + (low ? '.low' : ''), { style: { width: pct + '%' } })));
        })));
      var todayBox = h('div.card.sc', h('div.cardhead', h('h3', owner ? 'Sales today' : 'My sales today'), h('span.chip', U.num(mine.length, 0) + ' · ' + U.money(U.sum(mine, function (s) { return s.total; })))),
          mine.length ? h('div.list', mine.slice(0, 6).map(function (s) {
            var d = L.describe('sale', s);
            return UI.item({ icon: d.icon, tone: (L.product(s.productId) || {}).color || 'sky', title: d.title, sub: U.fmtTime(s.ts) + ' · ' + d.sub + (owner ? ' · ' + L.userName(s.userId) : ''), right: U.money(s.total) }, function () { Forms.detail('sale', s); });
          })) : h('p.muted.small', 'No sales recorded yet today.'),
          mine.length > 6 ? h('button.link', { type: 'button', onclick: function () { App.go('transactions'); } }, 'See all ' + mine.length + ' sales') : null);

      var wide = window.innerWidth >= 1100;
      var right = h('div.card.stack.entrycard.sb',
        h('div.row.between', h('div.grow', h('h3.ell', { style: { fontSize: '19px' } }, p.name), h('div.small.muted.b', sh ? 'Shift open since ' + U.fmtTime(sh.openedAt) : 'No shift open')),
          h('span.chip' + (L.isLow(p) ? '.low' : ''), U.qty(L.stockOf(p.id), unit) + ' left')),
        h('div.entry',
          h('div.stack',
            UI.seg([{ value: 'qty', label: unit === 'L' ? 'By litres' : 'By pieces' }, { value: 'amount', label: 'By peso amount' }], st.mode, function (v) { st.mode = v; st.entry = ''; App.refresh(); }),
            h('div.display', cap, val),
            h('div.quick', quick.map(function (q) { return h('button', { type: 'button', onclick: function () { st.entry = String(q); update(); } }, st.mode === 'amount' ? '\u20b1' + U.num(q, 0) : q + (unit === 'L' ? ' L' : '')); })),
            UI.keys(onKey, dec)),
          h('div.stack.paycol',
            h('div', { 'data-field': 'payment' }, h('div.small.b.muted', { style: { margin: '0 0 7px 4px' } }, 'Payment type'), UI.seg(Object.keys(L.PAY).map(function (k) { return { value: k, label: L.PAY[k], icon: PAY_ICON[k] }; }), st.pay, function (v) {
              st.pay = v;
              if (v === 'credit' && !st.customer) Forms.pickCustomer(function (c) { st.customer = c; App.refresh(); });
              App.refresh();
            })),
            st.pay === 'credit' ? h('button.btn.block', { type: 'button', onclick: function () { Forms.pickCustomer(function (c) { st.customer = c; App.refresh(); }); } }, U.icon('credit', 18), st.customer ? 'Charge to: ' + st.customer.name : 'Choose customer account') : null,
            totals, wide ? h('div.savebar', saveBtn) : null)),
        wide ? null : h('div.savebar', saveBtn));

      root.appendChild(h('div.sell', left, right, todayBox));
      update();
    }
  });
})();

// ====================================================================== Transactions
(function () {
  var st = { preset: 'today', from: U.today(), to: U.today(), type: '', productId: '', userId: '', q: '', limit: 100 };

  App.view('transactions', {
    enter: function (p) { st.limit = 100; if (p.preset) st.preset = p.preset; },
    render: function (root) {
      var owner = App.isOwner(), me = App.user(), listHost = h('div'), sumHost = h('div.row.wrap', { style: { marginBottom: '8px' } });
      function draw() {
        var r = Period.range(st);
        var rows = L.entries({ from: r.from, to: r.to, type: owner ? st.type : 'sale', productId: st.productId, userId: owner ? st.userId : me.id, q: st.q });
        var sales = 0, out = 0, nSales = 0;
        rows.forEach(function (d) { if (d.type === 'sale') { sales += d.amount; nSales++; } else if (d.type === 'expense') out += d.amount; });
        U.clear(sumHost);
        U.append(sumHost, [h('span.chip', { 'data-out': 'count' }, U.num(rows.length, 0) + (rows.length === 1 ? ' entry' : ' entries')), h('span.chip.ok', 'Sales ' + U.money(sales)),
          owner && out ? h('span.chip.warnc', 'Expenses ' + U.money(out)) : null]);
        U.clear(listHost);
        if (!rows.length) { listHost.appendChild(UI.empty('list', 'Nothing found', 'No entries match these filters. Try a wider date range.')); return; }
        var card = h('div.card.list', { style: { padding: '8px 16px' } });
        var lastDate = '';
        rows.slice(0, st.limit).forEach(function (d) {
          if (d.rec.date !== lastDate) { lastDate = d.rec.date; card.appendChild(h('div.small.b.muted', { style: { padding: '12px 0 4px' } }, U.fmtDay(d.rec.date) + (d.rec.date === U.today() ? ' · Today' : ''))); }
          var cls = d.qtyOnly ? (d.sign < 0 ? 'neg' : 'pos') : (d.sign > 0 ? '' : 'muted');
          card.appendChild(UI.item({ icon: d.icon, tone: d.tone, title: d.title, sub: d.sub, right: (d.qtyOnly ? '' : d.sign < 0 ? '−' : '') + d.amountText, rightSub: U.fmtTime(d.rec.ts) + (owner ? ' · ' + L.userName(d.rec.userId) : ''), cls: cls },
            function () { Forms.detail(d.type, d.rec); }));
        });
        listHost.appendChild(card);
        if (rows.length > st.limit) listHost.appendChild(h('div.center', { style: { marginTop: '12px' } }, h('button.btn', { type: 'button', onclick: function () { st.limit += 200; draw(); } }, 'Show more (' + (rows.length - st.limit) + ' left)')));
      }
      var typeOpts = [{ value: '', label: 'All types' }].concat(Object.keys(L.TYPES).map(function (k) { return { value: k, label: L.TYPES[k].label + 's' }; }));
      var userOpts = [{ value: '', label: 'All users' }].concat(DB.data.users.map(function (u) { return { value: u.id, label: u.displayName || u.username }; }));
      function sel(key, opts, label) { var s = UI.select(opts, st[key], function (v) { st[key] = v; st.limit = 100; if (key === 'preset') App.refresh(); else draw(); }, 'sm'); s.setAttribute('aria-label', label); s.setAttribute('data-filter', key); return s; }
      root.appendChild(h('div.toolbar',
        sel('preset', Period.options(['today', 'yesterday', '7d', 'month', 'lastmonth', 'all', 'custom']), 'Period'),
        st.preset === 'custom' ? Period.dates(st, draw) : null,
        owner ? sel('type', typeOpts, 'Type') : null,
        sel('productId', Forms.prodOptions(st.productId, 'All products'), 'Product'),
        owner ? sel('userId', userOpts, 'User') : null,
        h('input.input.sm', { type: 'search', placeholder: 'Search notes, supplier, DR no., customer…', 'aria-label': 'Search', value: st.q, style: { minWidth: '200px' }, oninput: function (e) { st.q = e.target.value; st.limit = 100; draw(); } })));
      root.appendChild(sumHost);
      root.appendChild(listHost);
      draw();
    }
  });
})();
