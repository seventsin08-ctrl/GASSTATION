'use strict';
/* Small helpers: dates, number formatting, DOM building. No dependencies. */
var U = (function () {
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dateStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return dateStr(new Date()); }
  function parseDate(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
  function monthOf(s) { return String(s).slice(0, 7); }
  function monthStart(s) { return monthOf(s) + '-01'; }
  function monthEnd(s) { var d = parseDate(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return dateStr(d); }
  function addMonths(ym, n) { var p = ym.split('-'); var d = new Date(+p[0], +p[1] - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function daysInMonth(ym) { var p = ym.split('-'); return new Date(+p[0], +p[1], 0).getDate(); }
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function fmtDate(s) { if (!s) return ''; var d = parseDate(s); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function fmtDateShort(s) { var d = parseDate(s); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function fmtDay(s) { var d = parseDate(s); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function fmtMonth(ym) { var p = ym.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function fmtTime(ts) { var d = new Date(ts); var h = d.getHours(); var ap = h < 12 ? 'AM' : 'PM'; h = h % 12; if (h === 0) h = 12; return h + ':' + pad(d.getMinutes()) + ' ' + ap; }
  function fmtDateTime(ts) { if (!ts) return ''; return fmtDate(dateStr(new Date(ts))) + ', ' + fmtTime(ts); }
  function toLocalInput(ts) { var d = new Date(ts); return dateStr(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fromLocalInput(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN;
  }
  /** Timestamp for an entry dated `date` (YYYY-MM-DD): now if today, else that day at the current clock time. */
  function tsForDate(date) {
    var now = new Date();
    if (date === dateStr(now)) return now.getTime();
    var d = parseDate(date); d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return d.getTime();
  }

  function round(n, d) { var f = Math.pow(10, d == null ? 2 : d); return Math.round((+n + (n >= 0 ? 1e-9 : -1e-9)) * f) / f; }
  function num(n, d, trim) {
    n = +n || 0; d = d == null ? 2 : d;
    var s = Math.abs(round(n, d)).toFixed(d);
    if (trim && s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (round(n, d) < 0 ? '-' : '') + parts.join('.');
  }
  function money(n) { n = round(+n || 0, 2); return (n < 0 ? '-' : '') + '₱' + num(Math.abs(n), 2); }
  function moneyShort(n) {
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e6) return s + '₱' + num(a / 1e6, a >= 1e7 ? 1 : 2, true) + 'M';
    if (a >= 1e4) return s + '₱' + num(a / 1e3, a >= 1e5 ? 0 : 1, true) + 'K';
    return s + '₱' + num(a, 0);
  }
  function unitLabel(unit) { return unit === 'L' ? 'L' : 'pc'; }
  function qty(n, unit) {
    if (unit === 'L') return num(n, 3, true) + ' L';
    var v = round(n, 3);
    return num(v, 3, true) + (Math.abs(v) === 1 ? ' pc' : ' pcs');
  }
  function pct(n) { return num(n, 1) + '%'; }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sum(arr, fn) { var t = 0; for (var i = 0; i < arr.length; i++) t += fn ? fn(arr[i]) : arr[i]; return t; }
  function initials(name) { var p = String(name || '?').trim().split(/\s+/); return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase(); }

  /**
   * Hyperscript: h('div.card.blue', {onclick: fn, title: 'x'}, child, [children], 'text').
   * Text is always inserted as text nodes, so user-entered names can never inject markup.
   */
  function h(spec, attrs) {
    var parts = spec.split('.');
    var el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    var start = 1;
    if (attrs && typeof attrs === 'object' && !attrs.nodeType && !Array.isArray(attrs)) {
      start = 2;
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className += (el.className ? ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') { for (var s in v) el.style[s] = v[s]; }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (var i = start; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) append(el, c[i]); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function icon(name, size) {
    var s = document.createElement('span');
    s.className = 'ico';
    var z = size || 20;
    s.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="' + z + '" height="' + z + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return s;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function hex(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); return s; }
  function unhex(s) { var b = new Uint8Array(s.length / 2); for (var i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16); return b; }
  function base64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  return {
    MONTHS: MONTHS, pad: pad, dateStr: dateStr, today: today, parseDate: parseDate, addDays: addDays, monthOf: monthOf, monthStart: monthStart,
    monthEnd: monthEnd, addMonths: addMonths, daysInMonth: daysInMonth, daysBetween: daysBetween, fmtDate: fmtDate, fmtDateShort: fmtDateShort,
    fmtDay: fmtDay, fmtMonth: fmtMonth, fmtTime: fmtTime, fmtDateTime: fmtDateTime, toLocalInput: toLocalInput, fromLocalInput: fromLocalInput,
    tsForDate: tsForDate, round: round, num: num, money: money, moneyShort: moneyShort, unitLabel: unitLabel, qty: qty, pct: pct, uid: uid,
    debounce: debounce, clone: clone, sum: sum, initials: initials, h: h, append: append, clear: clear, icon: icon, utf8: utf8, hex: hex,
    unhex: unhex, base64: base64
  };
})();
var h = U.h;
