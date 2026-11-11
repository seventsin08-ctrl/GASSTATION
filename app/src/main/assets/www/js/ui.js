'use strict';
/* Shared interface pieces: toasts, modals, confirm dialogs, the number keypad, form builder and charts. */
var UI = (function () {
  var stack = [];

  // ------------------------------------------------------------------ toast
  function toast(msg, kind) {
    var host = document.getElementById('toasts');
    var t = h('div.toast.' + (kind === 'err' ? 'err' : 'ok'), U.icon(kind === 'err' ? 'alert' : 'check', 18), msg);
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, kind === 'err' ? 4500 : 2600);
  }

  // ------------------------------------------------------------------ modal
  /** o: {title, body, actions: [{label, kind, left, grow, onClick(m)}], size: 'wide'|'narrow', dismiss: false to force a choice, onClose} */
  function modal(o) {
    var m = { closed: false };
    var body = h('div.mbody', o.body);
    var foot = h('div.mfoot');
    (o.actions || []).forEach(function (a) {
      var b = h('button.btn' + (a.kind ? '.' + a.kind : '') + (a.left ? '.left' : '') + (a.grow ? '.grow' : ''), { type: 'button', onclick: function () { a.onClick(m, b); } }, a.icon ? U.icon(a.icon, 18) : null, a.label);
      if (a.ref) m[a.ref] = b;
      foot.appendChild(b);
    });
    var box = h('div.modal' + (o.size ? '.' + o.size : ''), { role: 'dialog' },
      h('div.mhead', h('h2', o.title || ''), o.dismiss === false ? null : h('button.iconbtn', { type: 'button', 'aria-label': 'Close', onclick: function () { m.close(); } }, U.icon('close'))),
      body, (o.actions && o.actions.length) ? foot : null);
    var ov = h('div.overlay', { onclick: function (e) { if (e.target === ov && o.dismiss !== false) m.close(); } }, box);
    m.el = box; m.body = body; m.dismiss = o.dismiss !== false;
    m.close = function (result) {
      if (m.closed) return;
      m.closed = true;
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      var i = stack.indexOf(m); if (i >= 0) stack.splice(i, 1);
      if (o.onClose) o.onClose(result);
    };
    stack.push(m);
    document.getElementById('modals').appendChild(ov);
    return m;
  }
  function closeAll() { stack.slice().forEach(function (m) { m.close(); }); }
  /** Closes the top-most dialog (Android back button). Returns true if there was one. */
  function back() {
    if (!stack.length) return false;
    var m = stack[stack.length - 1];
    if (m.dismiss) m.close();
    return true;
  }
  /** Resolves true only when the user presses the confirm button. */
  function confirm(o) {
    return new Promise(function (res) {
      var done = false;
      modal({ title: o.title, size: 'narrow', body: h('div.stack', h('p', { style: { fontWeight: 500 } }, o.message), o.detail ? h('div.banner' + (o.danger ? '.neg' : ''), U.icon('alert', 18), h('span', o.detail)) : null),
        onClose: function () { if (!done) res(false); },
        actions: [{ label: o.cancelLabel || 'Cancel', onClick: function (m) { m.close(); } },
          { label: o.confirmLabel || 'Confirm', kind: o.danger ? 'danger' : 'primary', onClick: function (m) { done = true; m.close(); res(true); } }] });
    });
  }
  function alert(title, message) { modal({ title: title, size: 'narrow', body: h('p', { style: { fontWeight: 500 } }, message), actions: [{ label: 'OK', kind: 'primary', onClick: function (m) { m.close(); } }] }); }

  // ------------------------------------------------------------------ keypad
  /** Applies one key press to an entry string. Keys: 0-9, '.', '00', 'back', 'clear'. */
  function press(str, key, decimals) {
    if (key === 'clear') return '';
    if (key === 'back') return str.slice(0, -1);
    if (key === '.') { if (decimals <= 0 || str.indexOf('.') >= 0) return str; return (str || '0') + '.'; }
    var dot = str.indexOf('.');
    for (var i = 0; i < key.length; i++) {
      if (dot >= 0 && str.length - dot > decimals) break;
      if (dot < 0 && str.replace('.', '').length >= 9) break;
      str = (str === '0') ? key.charAt(i) : str + key.charAt(i);
    }
    return str;
  }
  function keys(onKey, decimals) {
    var g = h('div.keys');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals > 0 ? '.' : '00', '0', 'back'].forEach(function (k) {
      g.appendChild(h('button.key', { type: 'button', 'data-key': k, 'aria-label': k === 'back' ? 'Delete' : k, onclick: function () { onKey(k); } }, k === 'back' ? U.icon('backspace', 26) : k));
    });
    return g;
  }
  function showEntry(el, str, prefix, suffix) {
    U.clear(el);
    el.className = 'val' + (str ? '' : ' zero');
    var parts = (str || '0').split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    U.append(el, [(prefix || '') + parts.join('.'), suffix ? h('span.u', suffix) : null]);
  }
  /** Opens the number keypad. Resolves with a number, null (cleared) or undefined (cancelled). */
  function keypad(o) {
    return new Promise(function (res) {
      var dec = o.decimals == null ? 2 : o.decimals;
      var str = (o.value != null && o.value !== '' && isFinite(o.value)) ? String(U.round(o.value, dec)) : '';
      var val = h('div.val'), result;
      function draw() { showEntry(val, str, o.prefix, o.suffix); }
      function onKey(k) { str = press(str, k, dec); draw(); }
      function typed(e) {
        if (stack[stack.length - 1] !== m) return;
        if (/^[0-9.]$/.test(e.key)) onKey(e.key); else if (e.key === 'Backspace') onKey('back'); else if (e.key === 'Enter') ok(); else return;
        e.preventDefault();
      }
      function ok() { result = str === '' || str === '.' ? null : parseFloat(str); m.close(); }
      draw();
      var m = modal({ title: o.title || 'Enter amount', size: 'narrow',
        body: h('div.stack', h('div.display', h('div.cap', o.hint || ''), val), keys(onKey, dec)),
        onClose: function () { document.removeEventListener('keydown', typed); res(result); },
        actions: [{ label: 'Clear', left: true, onClick: function () { onKey('clear'); } }, { label: 'Done', kind: 'primary', grow: true, onClick: ok }] });
      document.addEventListener('keydown', typed);
    });
  }

  // ------------------------------------------------------------------ small controls
  function seg(options, value, onChange) {
    var el = h('div.seg'), btns = [];
    options.forEach(function (o) {
      var b = h('button' + (o.value === value ? '.on' : ''), { type: 'button', 'data-v': o.value, onclick: function () {
        if (o.value === el.value) return;
        el.value = o.value;
        btns.forEach(function (x) { x.className = x === b ? 'on' : ''; });
        onChange(o.value);
      } }, o.icon ? U.icon(o.icon, 17) : null, o.label);
      btns.push(b); el.appendChild(b);
    });
    el.value = value;
    return el;
  }
  function pills(options, value, onChange) {
    return h('div.pills', options.map(function (o) {
      return h('button.pill' + (o.value === value ? '.on' : ''), { type: 'button', 'data-v': o.value, onclick: function () { onChange(o.value); } }, o.label);
    }));
  }
  function select(options, value, onChange, cls) {
    var s = h('select.input' + (cls ? '.' + cls : ''), { onchange: function () { onChange(s.value); } }, options.map(function (o) {
      return h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label);
    }));
    return s;
  }
  function empty(icon, title, text, action) {
    return h('div.empty', h('div.bubble', U.icon(icon, 28)), h('h3', title), text ? h('p', text) : null, action || null);
  }
  function item(d, onClick, extra) {
    return h(onClick ? 'button.item' : 'div.item', onClick ? { type: 'button', onclick: onClick } : {},
      h('div.bubble.' + (d.tone || 'sky'), U.icon(d.icon, 21)),
      h('div.grow', h('div.t.ell', d.title), h('div.s.ell', d.sub)),
      h('div.amt' + (d.cls ? '.' + d.cls : ''), d.right, d.rightSub ? h('small', d.rightSub) : null), extra || null);
  }
  function dl(pairs) {
    var el = h('dl.dl');
    pairs.forEach(function (p) { if (p && p[1] != null && p[1] !== '') { el.appendChild(h('dt', p[0])); el.appendChild(h('dd' + (p[2] ? '.' + p[2] : ''), p[1])); } });
    return el;
  }
  function table(columns, rows, totals) {
    function cell(tag, v, c) { return h(tag + (Exporter.isNum(c.type) ? '.r' : ''), Exporter.fmt(v, c.type)); }
    return h('div.tblwrap', h('table.tbl',
      h('thead', h('tr', columns.map(function (c) { return h('th' + (Exporter.isNum(c.type) ? '.r' : ''), c.label); }))),
      h('tbody', rows.length ? rows.map(function (r) { return h('tr', columns.map(function (c, i) { return cell('td', r[i], c); })); })
        : h('tr', h('td.muted', { colspan: columns.length }, 'No entries in this period.'))),
      (totals && rows.length) ? h('tfoot', h('tr', columns.map(function (c, i) { return cell('td', totals[i], c); }))) : null));
  }

  // ------------------------------------------------------------------ form builder
  /**
   * o: {title, fields, submit, onSubmit(values) -> may return a Promise or throw Error(message), actions (extra buttons), size, intro, onChange(values, api)}
   * field: {key, label, type, value, options, hint, placeholder, decimals, prefix, suffix, full, list}
   * types: text, password, textarea, date, datetime, month, select, seg, money, qty, int, cost, toggle, info, swatch
   */
  function form(o) {
    var values = {}, ctl = {}, err = h('div.formerr'), api, m, busy = false;
    function changed(key) { if (o.onChange) o.onChange(values, api, key); }
    function numDec(f) { var d = typeof f.decimals === 'function' ? f.decimals(values) : f.decimals; return d != null ? d : f.type === 'money' ? 2 : f.type === 'cost' ? 4 : f.type === 'int' ? 0 : 3; }
    function build(f) {
      var c = { f: f }, el;
      values[f.key] = f.value == null ? (f.type === 'toggle' ? false : (/^(money|qty|int|cost)$/.test(f.type) ? null : '')) : f.value;
      if (/^(money|qty|int|cost)$/.test(f.type)) {
        el = h('button.numfield', { type: 'button', 'data-field': f.key, onclick: function () {
          var pre = typeof f.prefix === 'function' ? f.prefix(values) : f.prefix, suf = typeof f.suffix === 'function' ? f.suffix(values) : f.suffix;
          if (pre == null && (f.type === 'money' || f.type === 'cost')) pre = '₱';
          keypad({ title: f.label, value: values[f.key], decimals: numDec(f), prefix: pre, suffix: suf, hint: f.padHint || '' }).then(function (v) {
            if (v === undefined) return;
            values[f.key] = v; c.draw(); changed(f.key);
          });
        } });
        c.draw = function () {
          U.clear(el);
          var v = values[f.key], pre = typeof f.prefix === 'function' ? f.prefix(values) : f.prefix, suf = typeof f.suffix === 'function' ? f.suffix(values) : f.suffix;
          if (pre == null && (f.type === 'money' || f.type === 'cost')) pre = '₱';
          U.append(el, [v == null ? h('span.ph', f.placeholder || 'Tap to enter') : h('span', (pre || '') + U.num(v, numDec(f), f.type === 'qty' || f.type === 'cost' && false) + (suf ? ' ' + suf : '')), U.icon('edit', 16)]);
        };
        c.draw();
      } else if (f.type === 'select') {
        el = select(f.options || [], values[f.key], function (v) { values[f.key] = v; changed(f.key); });
        el.setAttribute('data-field', f.key);
        c.draw = function () { el.value = values[f.key]; };
        c.setOptions = function (opts) { U.clear(el); opts.forEach(function (x) { el.appendChild(h('option', { value: x.value }, x.label)); }); el.value = values[f.key]; };
      } else if (f.type === 'seg') {
        var holder = h('div', { 'data-field': f.key });
        c.draw = function () { U.clear(holder); holder.appendChild(seg(c.opts || f.options, values[f.key], function (v) { values[f.key] = v; changed(f.key); })); };
        c.setOptions = function (opts) { c.opts = opts; c.draw(); };
        c.draw(); el = holder;
      } else if (f.type === 'toggle') {
        var sw = h('button.switch' + (values[f.key] ? '.on' : ''), { type: 'button', 'data-field': f.key, onclick: function () { values[f.key] = !values[f.key]; c.draw(); changed(f.key); } });
        c.draw = function () { sw.className = 'switch' + (values[f.key] ? ' on' : ''); };
        el = h('div.row.between', h('span.b', f.text || ''), sw);
      } else if (f.type === 'info') {
        el = h('div.card.flat.small', { style: { padding: '14px 16px', fontWeight: 600 } });
        c.draw = function () { U.clear(el); U.append(el, values[f.key]); };
        c.draw();
      } else if (f.type === 'swatch') {
        el = h('div.swatches', { 'data-field': f.key });
        c.draw = function () { U.clear(el); f.options.forEach(function (x) { el.appendChild(h('button.' + x + (values[f.key] === x ? '.on' : ''), { type: 'button', 'aria-label': x, onclick: function () { values[f.key] = x; c.draw(); } })); }); };
        c.draw();
      } else {
        var attrs = { 'data-field': f.key, placeholder: f.placeholder || '', autocomplete: f.type === 'password' ? 'new-password' : 'off', autocapitalize: f.caps || 'sentences', spellcheck: 'false',
          oninput: function () { values[f.key] = el.value; changed(f.key); }, onchange: function () { values[f.key] = el.value; changed(f.key); } };
        if (f.type === 'textarea') el = h('textarea.input', attrs);
        else {
          attrs.type = f.type === 'datetime' ? 'datetime-local' : (f.type || 'text');
          if (f.max) attrs.max = f.max;
          if (f.list) { attrs.list = 'dl-' + f.key; }
          el = h('input.input', attrs);
        }
        el.value = values[f.key];
        c.draw = function () { el.value = values[f.key]; };
      }
      c.hint = h('span.hint', f.hint || '');
      if (!f.hint) c.hint.style.display = 'none';
      c.wrap = h('label.field' + (f.full || f.type === 'textarea' || f.type === 'info' || f.type === 'seg' ? '.full' : ''), f.label && f.type !== 'info' ? h('span.lbl', f.label) : null, el,
        f.list ? h('datalist', { id: 'dl-' + f.key }, f.list.map(function (x) { return h('option', { value: x }); })) : null, c.hint);
      if (f.type !== 'text' && f.type !== 'password' && f.type !== 'textarea') c.wrap.addEventListener('click', function (e) { if (e.target === c.wrap || e.target.className === 'lbl') e.preventDefault(); });
      if (f.hidden) c.wrap.style.display = 'none';
      ctl[f.key] = c;
      return c.wrap;
    }
    api = {
      values: values,
      set: function (k, v) { values[k] = v; if (ctl[k]) ctl[k].draw(); },
      show: function (k, on) { if (ctl[k]) ctl[k].wrap.style.display = on ? '' : 'none'; },
      hint: function (k, text, warn) { var c = ctl[k]; if (!c) return; c.hint.textContent = text || ''; c.hint.style.display = text ? '' : 'none'; c.hint.className = 'hint' + (warn ? ' warn' : ''); },
      options: function (k, opts) { if (ctl[k] && ctl[k].setOptions) ctl[k].setOptions(opts); },
      label: function (k, text) { var l = ctl[k] && ctl[k].wrap.querySelector('.lbl'); if (l) l.textContent = text; },
      error: function (msg) { U.clear(err); if (msg) err.appendChild(h('div.banner.neg', U.icon('alert', 18), h('span', msg))); },
      close: function () { m.close(); }
    };
    var grid = h('div.fields' + (o.fields.length > 3 && o.columns !== 1 ? '.two' : ''), o.fields.map(build));
    function submit() {
      if (busy) return;
      api.error('');
      var p;
      try { p = Promise.resolve(o.onSubmit(values, api)); } catch (e) { api.error(e.message); return; }
      busy = true; if (m.submitBtn) m.submitBtn.disabled = true;
      p.then(function (keepOpen) { busy = false; if (m.submitBtn) m.submitBtn.disabled = false; if (keepOpen !== false) m.close(); })
        .catch(function (e) { busy = false; if (m.submitBtn) m.submitBtn.disabled = false; api.error(e && e.message ? e.message : String(e)); });
    }
    var actions = (o.actions || []).map(function (a) { return { label: a.label, kind: a.kind, left: true, icon: a.icon, onClick: function () { a.onClick(api, values); } }; });
    actions.push({ label: 'Cancel', onClick: function (mm) { mm.close(); } });
    actions.push({ label: o.submit || 'Save', kind: 'primary', ref: 'submitBtn', onClick: submit });
    m = modal({ title: o.title, size: o.size, body: h('form', { onsubmit: function (e) { e.preventDefault(); submit(); } }, o.intro ? h('p.muted.small', { style: { marginBottom: '14px', fontWeight: 500 } }, o.intro) : null, grid, err, h('button.hide', { type: 'submit' })), actions: actions });
    if (o.onChange) o.onChange(values, api, null);
    return api;
  }

  // ------------------------------------------------------------------ charts
  var NS = 'http://www.w3.org/2000/svg';
  var PALETTE = ['#7667e0', '#35b377', '#e2b12f', '#4a97e6', '#ee8656', '#de6497', '#35b8be', '#98a0b0', '#a888dd', '#6f7a8c'];
  function s(tag, attrs, text) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    return el;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  /** Grouped bars: sales and gross profit per bucket. Tap a bucket to read its figures. */
  function barChart(buckets, width) {
    var W = Math.max(280, width || 600), H = 230, L = 46, R = 8, T = 10, B = 26;
    var hi = 0, lo = 0;
    buckets.forEach(function (b) { hi = Math.max(hi, b.sales, b.gross); lo = Math.min(lo, b.gross); });
    hi = niceMax(hi); if (lo < 0) lo = -niceMax(-lo);
    var plotH = H - T - B, plotW = W - L - R, span = hi - lo;
    function y(v) { return T + (hi - v) / span * plotH; }
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, height: H, role: 'img', 'aria-label': 'Sales and gross profit chart' });
    for (var g = 0; g <= 4; g++) {
      var gv = lo + span * g / 4;
      svg.appendChild(s('line', { x1: L, x2: W - R, y1: y(gv), y2: y(gv), 'class': Math.abs(gv) < 1e-9 ? 'zero' : 'gridl' }));
      svg.appendChild(s('text', { x: L - 8, y: y(gv) + 4, 'text-anchor': 'end' }, U.moneyShort(gv)));
    }
    var n = buckets.length, slot = plotW / n, bw = Math.max(2, Math.min(16, slot * 0.34)), every = Math.ceil(n / Math.max(1, Math.floor(plotW / 34)));
    var cap = h('div.caption'), hits = [];
    function pick(i) {
      var b = buckets[i];
      hits.forEach(function (x, j) { x.setAttribute('class', j === i ? 'hit on' : 'hit'); });
      U.clear(cap);
      U.append(cap, [h('b', b.long), ' · Sales ', h('b', U.money(b.sales)), ' · Gross profit ', h('b', U.money(b.gross))]);
    }
    buckets.forEach(function (b, i) {
      var cx = L + slot * i + slot / 2;
      var hit = s('rect', { x: L + slot * i, y: T, width: slot, height: plotH, rx: 6, 'class': 'hit' });
      hits.push(hit); svg.appendChild(hit);
      function bar(v, x, color) {
        if (!v) return;
        var y0 = y(Math.max(0, v)), hh = Math.max(1.5, Math.abs(y(v) - y(0)));
        svg.appendChild(s('rect', { x: x, y: y0, width: bw, height: hh, rx: Math.min(4, bw / 2), fill: color, 'pointer-events': 'none' }));
      }
      bar(b.sales, cx - bw - 1, 'var(--c-sales)');
      bar(b.gross, cx + 1, b.gross < 0 ? 'var(--neg)' : 'var(--c-profit)');
      if (i % every === 0) svg.appendChild(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, b.label));
      hit.addEventListener('click', function () { pick(i); });
    });
    var last = -1;
    buckets.forEach(function (b, i) { if (b.sales || b.gross) last = i; });
    if (last >= 0) pick(last); else cap.textContent = 'No sales in this period yet.';
    return h('div.chart', h('div.legend', { style: { marginBottom: '8px' } }, h('span', h('i', { style: { background: 'var(--c-sales)' } }), 'Sales'), h('span', h('i', { style: { background: 'var(--c-profit)' } }), 'Gross profit')), svg, cap);
  }
  /** Donut with a legend that carries the actual amounts. items: [{label, value}] */
  function donut(items, centerLabel) {
    var total = U.sum(items, function (i) { return i.value; });
    var svg = s('svg', { viewBox: '0 0 150 150', role: 'img', 'aria-label': centerLabel || 'Breakdown' });
    var r = 56, c = 2 * Math.PI * r, off = 0;
    svg.appendChild(s('circle', { cx: 75, cy: 75, r: r, fill: 'none', stroke: 'var(--bg3)', 'stroke-width': 22 }));
    var shown = items.slice(0, 7), rest = U.sum(items.slice(7), function (i) { return i.value; });
    if (rest > 0) shown.push({ label: 'Other categories', value: rest });
    shown.forEach(function (it, i) {
      var len = total > 0 ? it.value / total * c : 0;
      svg.appendChild(s('circle', { cx: 75, cy: 75, r: r, fill: 'none', stroke: PALETTE[i % PALETTE.length], 'stroke-width': 22, 'stroke-dasharray': Math.max(0, len - 1.5) + ' ' + (c - Math.max(0, len - 1.5)), 'stroke-dashoffset': -off, transform: 'rotate(-90 75 75)' }));
      off += len;
    });
    var t1 = s('text', { x: 75, y: 72, 'text-anchor': 'middle' }, centerLabel || 'Total');
    var t2 = s('text', { x: 75, y: 90, 'text-anchor': 'middle', style: 'font-size:15px;font-weight:800;fill:var(--text)' }, U.moneyShort(total));
    svg.appendChild(t1); svg.appendChild(t2);
    return h('div.chart.donutwrap', svg, h('div.dleg', shown.map(function (it, i) {
      return h('div.dl-row', h('i', { style: { background: PALETTE[i % PALETTE.length] } }), h('span.ell', it.label), h('span.v', U.money(it.value), h('span.muted', ' · ' + U.num(total > 0 ? it.value / total * 100 : 0, 0) + '%')));
    })));
  }
  /** Horizontal bars with the value written on each row. items: [{label, value, sub}] */
  function hbars(items) {
    var max = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); }).concat([1]));
    return h('div', items.map(function (it) {
      return h('div.hbar', h('div.top', h('span.ell', it.label, it.sub ? h('span.muted', ' · ' + it.sub) : null), h('span' + (it.value < 0 ? '.neg' : ''), U.money(it.value))),
        h('div.meter', h('i' + (it.value < 0 ? '.negbar' : ''), { style: { width: Math.max(1.5, Math.abs(it.value) / max * 100) + '%' } })));
    }));
  }
  function tank(p, stock, small) {
    var cap = p.capacity > 0 ? p.capacity : Math.max(stock, 1), pct = Math.max(0, Math.min(100, stock / cap * 100)), low = L.isLow(p);
    return h('div.tank' + (small ? '.sm' : ''), { role: 'img', 'aria-label': p.name + ' ' + U.num(pct, 0) + '% full' },
      h('div.fill' + (low ? '.low' : ''), { style: { height: pct + '%', background: low ? '' : 'var(--' + (p.color || 'sky') + '-ink)' } }),
      (!small && p.reorderLevel > 0 && p.capacity > 0) ? h('div.mark', { style: { bottom: Math.min(100, p.reorderLevel / cap * 100) + '%' } }) : null,
      small ? null : h('div.pctl', U.num(pct, 0) + '%'));
  }

  return { toast: toast, modal: modal, closeAll: closeAll, back: back, confirm: confirm, alert: alert, press: press, keys: keys, showEntry: showEntry, keypad: keypad,
    seg: seg, pills: pills, select: select, empty: empty, item: item, dl: dl, table: table, form: form, barChart: barChart, donut: donut, hbars: hbars, tank: tank, PALETTE: PALETTE };
})();
