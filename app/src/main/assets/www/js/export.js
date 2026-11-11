'use strict';
/*
 * Report export: PDF, Excel (.xlsx) and CSV, all generated on the device with no libraries.
 * Input is the report structure produced in logic.js:
 *   {title, period, sections: [{name, columns: [{label, type}], rows: [[...]], totals: [...]}]}
 */
var Exporter = (function () {
  function fmt(v, type) {
    if (v == null || v === '') return '';
    if (typeof v !== 'number') return String(v);
    switch (type) {
      case 'money': return U.money(v);
      case 'cost': return '₱' + U.num(v, 4);
      case 'qty': return U.num(v, 3, true);
      case 'int': return U.num(v, 0);
      case 'pct': return U.num(v, 1) + '%';
      default: return String(v);
    }
  }
  function isNum(type) { return type && type !== 'text'; }
  function ascii(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
  function concat(chunks) {
    var n = 0, i; for (i = 0; i < chunks.length; i++) n += chunks[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
    return out;
  }

  // ================================================================== PDF
  var WIN = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139,
    'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153,
    'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };
  var PESO = '₱';
  /** Maps text to WinAnsi codes. The peso sign is not in the standard PDF fonts, so it is drawn as "P" plus two strokes. */
  function codes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i), c = str.charCodeAt(i);
      if (ch === PESO) out.push(-80);
      else if (c >= 32 && c < 127) out.push(c);
      else if (c >= 160 && c <= 255) out.push(c);
      else if (WIN[ch]) out.push(WIN[ch]);
      else if (c === 9 || c === 10 || c === 13) out.push(32);
      else if (ch === '→') { out.push(45); out.push(62); }
      else if (ch === '−') out.push(45);
      else out.push(63);
    }
    return out;
  }
  function widthOf(cs, bold, size) {
    var w = PDF_WIDTHS[bold ? 'bold' : 'regular'], t = 0;
    for (var i = 0; i < cs.length; i++) t += w[Math.abs(cs[i]) - 32] || 500;
    return t * size / 1000;
  }
  function n2(n) { return (Math.round(n * 100) / 100).toString(); }

  function Pdf(landscape) {
    this.W = landscape ? 841.89 : 595.28; this.H = landscape ? 595.28 : 841.89;
    this.pages = []; this.img = null;
    this.addPage();
  }
  Pdf.prototype.addPage = function () { this.cur = []; this.pages.push(this.cur); };
  Pdf.prototype.width = function (str, bold, size) { return widthOf(codes(String(str)), bold, size); };
  Pdf.prototype.fit = function (str, maxW, bold, size) {
    str = String(str);
    if (this.width(str, bold, size) <= maxW) return str;
    while (str.length > 1 && this.width(str + '...', bold, size) > maxW) str = str.slice(0, -1);
    return str.replace(/\s+$/, '') + '...';
  };
  /** Draws text with its baseline at y (measured from the top of the page). o: {bold, size, align, color, maxW}. */
  Pdf.prototype.text = function (x, y, str, o) {
    o = o || {};
    var size = o.size || 9, bold = !!o.bold, col = o.color || [0.1, 0.1, 0.12];
    if (o.maxW) str = this.fit(str, o.maxW, bold, size);
    var cs = codes(String(str)), w = widthOf(cs, bold, size);
    if (o.align === 'right') x -= w; else if (o.align === 'center') x -= w / 2;
    var s = '', pesos = [], i;
    for (i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c < 0) { pesos.push(widthOf(cs.slice(0, i), bold, size)); c = -c; }
      if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
      else if (c > 126) s += '\\' + c.toString(8);
      else s += String.fromCharCode(c);
    }
    var rgb = n2(col[0]) + ' ' + n2(col[1]) + ' ' + n2(col[2]);
    this.cur.push('BT /F' + (bold ? 2 : 1) + ' ' + n2(size) + ' Tf ' + rgb + ' rg ' + n2(x) + ' ' + n2(this.H - y) + ' Td (' + s + ') Tj ET');
    for (i = 0; i < pesos.length; i++) {
      var px = x + pesos[i], lw = size * (bold ? 0.062 : 0.048);
      this.line(px, y - size * 0.565, px + size * 0.66, y - size * 0.565, lw, col);
      this.line(px, y - size * 0.445, px + size * 0.66, y - size * 0.445, lw, col);
    }
    return w;
  };
  Pdf.prototype.rect = function (x, y, w, hgt, col) {
    this.cur.push(n2(col[0]) + ' ' + n2(col[1]) + ' ' + n2(col[2]) + ' rg ' + n2(x) + ' ' + n2(this.H - y - hgt) + ' ' + n2(w) + ' ' + n2(hgt) + ' re f');
  };
  Pdf.prototype.line = function (x1, y1, x2, y2, lw, col) {
    this.cur.push(n2(col[0]) + ' ' + n2(col[1]) + ' ' + n2(col[2]) + ' RG ' + n2(lw) + ' w ' + n2(x1) + ' ' + n2(this.H - y1) + ' m ' + n2(x2) + ' ' + n2(this.H - y2) + ' l S');
  };
  Pdf.prototype.image = function (jpegBytes, pxW, pxH, x, y, w, hgt) {
    this.img = { bytes: jpegBytes, w: pxW, h: pxH };
    this.cur.push('q ' + n2(w) + ' 0 0 ' + n2(hgt) + ' ' + n2(x) + ' ' + n2(this.H - y - hgt) + ' cm /Im1 Do Q');
  };
  Pdf.prototype.build = function () {
    var chunks = [], offsets = [], pos = 0, self = this;
    function put(b) { if (typeof b === 'string') b = ascii(b); chunks.push(b); pos += b.length; }
    function obj(n, body, stream) {
      offsets[n] = pos;
      put(n + ' 0 obj\n' + body + '\n');
      if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
      put('endobj\n');
    }
    var first = 6, kids = [];
    for (var i = 0; i < this.pages.length; i++) kids.push((first + i * 2) + ' 0 R');
    put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + this.pages.length + ' >>');
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    if (this.img) obj(5, '<< /Type /XObject /Subtype /Image /Width ' + this.img.w + ' /Height ' + this.img.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + this.img.bytes.length + ' >>', this.img.bytes);
    else obj(5, '<< >>');
    this.pages.forEach(function (ops, idx) {
      var content = ascii(ops.join('\n'));
      obj(first + idx * 2, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + n2(self.W) + ' ' + n2(self.H) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' +
        (self.img ? ' /XObject << /Im1 5 0 R >>' : '') + ' >> /Contents ' + (first + idx * 2 + 1) + ' 0 R >>');
      obj(first + idx * 2 + 1, '<< /Length ' + content.length + ' >>', content);
    });
    var count = first + this.pages.length * 2, xref = pos, x = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
    for (var n = 1; n < count; n++) x += ('0000000000' + offsets[n]).slice(-10) + ' 00000 n \n';
    put(x + 'trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return concat(chunks);
  };

  function dataUrlBytes(url) {
    var bin = atob(url.slice(url.indexOf(',') + 1)), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }

  /** meta: {stationName, address, logo: {dataUrl, w, h} | null, by} */
  function toPdf(report, meta) {
    var maxCols = Math.max.apply(null, report.sections.map(function (s) { return s.columns.length; }));
    var pdf = new Pdf(maxCols > 7), M = 36, avail = pdf.W - M * 2, y = M;
    var DARK = [0.1, 0.1, 0.12], MUTED = [0.42, 0.44, 0.5], FS = 8.5, ROW = 17;

    // Header
    var tx = M;
    if (meta.logo && meta.logo.dataUrl && /^data:image\/jpeg/.test(meta.logo.dataUrl)) {
      var lh = 44, lw = Math.min(110, lh * meta.logo.w / meta.logo.h);
      try { pdf.image(dataUrlBytes(meta.logo.dataUrl), meta.logo.w, meta.logo.h, M, y, lw, lh); tx = M + lw + 12; } catch (e) { /* skip logo */ }
    }
    pdf.text(tx, y + 15, meta.stationName || 'Gas Station', { bold: true, size: 15, maxW: avail * 0.55 });
    if (meta.address) pdf.text(tx, y + 29, meta.address, { size: 9, color: MUTED, maxW: avail * 0.55 });
    pdf.text(pdf.W - M, y + 15, report.title, { bold: true, size: 13, align: 'right' });
    pdf.text(pdf.W - M, y + 29, report.period, { size: 9, color: MUTED, align: 'right' });
    pdf.text(pdf.W - M, y + 41, 'Generated ' + U.fmtDateTime(Date.now()) + (meta.by ? ' by ' + meta.by : ''), { size: 7.5, color: MUTED, align: 'right' });
    y += 54;
    pdf.line(M, y, pdf.W - M, y, 0.8, [0.82, 0.83, 0.86]);
    y += 20;

    report.sections.forEach(function (sec) {
      var cols = sec.columns, i;
      // Natural widths from content, then scaled to the page.
      var nat = cols.map(function (c, ci) {
        var w = pdf.width(c.label, true, FS);
        sec.rows.forEach(function (r) { w = Math.max(w, pdf.width(fmt(r[ci], c.type), false, FS)); });
        if (sec.totals) w = Math.max(w, pdf.width(fmt(sec.totals[ci], c.type), true, FS));
        return Math.min(w, 220) + 12;
      });
      var total = U.sum(nat), scale = Math.min(1.6, avail / total);
      var widths = nat.map(function (w) { return w * scale; }), xs = [], acc = M;
      for (i = 0; i < widths.length; i++) { xs.push(acc); acc += widths[i]; }
      var tableW = acc - M;

      function headerRow() {
        pdf.rect(M, y, tableW, ROW + 2, [0.92, 0.93, 0.95]);
        cols.forEach(function (c, ci) {
          var right = isNum(c.type);
          pdf.text(right ? xs[ci] + widths[ci] - 6 : xs[ci] + 6, y + 12.5, c.label, { bold: true, size: FS, align: right ? 'right' : 'left', maxW: widths[ci] - 8 });
        });
        y += ROW + 2;
      }
      function dataRow(r, bold, zebra) {
        if (zebra) pdf.rect(M, y, tableW, ROW, [0.972, 0.974, 0.98]);
        cols.forEach(function (c, ci) {
          var right = isNum(c.type), s = fmt(r[ci], c.type);
          if (s) pdf.text(right ? xs[ci] + widths[ci] - 6 : xs[ci] + 6, y + 11.5, s, { bold: bold, size: FS, align: right ? 'right' : 'left', maxW: widths[ci] - 8 });
        });
        y += ROW;
      }
      function room(need) { if (y + need > pdf.H - M - 18) { pdf.addPage(); y = M; return true; } return false; }

      room(ROW * 4 + 20);
      pdf.text(M, y, sec.name, { bold: true, size: 11 });
      y += 9;
      headerRow();
      if (!sec.rows.length) { pdf.text(M + 6, y + 12, 'No entries in this period.', { size: FS, color: MUTED }); y += ROW; }
      sec.rows.forEach(function (r, ri) { if (room(ROW)) headerRow(); dataRow(r, false, ri % 2 === 1); });
      if (sec.totals && sec.rows.length) {
        if (room(ROW + 2)) headerRow();
        pdf.line(M, y, M + tableW, y, 0.8, DARK);
        y += 1;
        dataRow(sec.totals, true, false);
      }
      y += 24;
    });

    var n = pdf.pages.length;
    pdf.pages.forEach(function (ops, idx) {
      pdf.cur = ops;
      pdf.text(M, pdf.H - 22, (meta.stationName || '') + ' · ' + report.title, { size: 7.5, color: MUTED, maxW: avail * 0.7 });
      pdf.text(pdf.W - M, pdf.H - 22, 'Page ' + (idx + 1) + ' of ' + n, { size: 7.5, color: MUTED, align: 'right' });
    });
    return pdf.build();
  }

  // ================================================================== ZIP (stored, no compression) for XLSX
  var crcTable = null;
  function crc32(b) {
    var i, j, c;
    if (!crcTable) { crcTable = []; for (i = 0; i < 256; i++) { c = i; for (j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crcTable[i] = c >>> 0; } }
    c = 0xFFFFFFFF;
    for (i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    var chunks = [], central = [], pos = 0;
    function le(v, n) { var b = new Uint8Array(n); for (var i = 0; i < n; i++) b[i] = (v >>> (8 * i)) & 255; return b; }
    files.forEach(function (f) {
      var name = ascii(f.name), data = f.data, crc = crc32(data);
      var common = concat([le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2)]);
      var local = concat([le(0x04034b50, 4), common, name, data]);
      central.push(concat([le(0x02014b50, 4), le(20, 2), common, le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(pos, 4), name]));
      chunks.push(local); pos += local.length;
    });
    var cd = concat(central);
    chunks.push(cd);
    chunks.push(concat([le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), le(cd.length, 4), le(pos, 4), le(0, 2)]));
    return concat(chunks);
  }

  // ================================================================== XLSX
  function xml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  // Style indexes (see styles.xml below): plain/bold pairs per number type.
  var XF = { text: 0, money: 2, qty: 4, int: 6, pct: 8, cost: 10 };
  function toXlsx(report, meta) {
    var used = {};
    var sheets = report.sections.map(function (sec, si) {
      var name = sec.name.replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 28) || ('Sheet' + (si + 1));
      if (used[name.toLowerCase()]) name = name.slice(0, 25) + ' ' + (si + 1);
      used[name.toLowerCase()] = true;
      var rows = [], r = 0;
      function cell(c, v, type, bold, style) {
        var ref = colName(c) + (r + 1);
        if (v == null || v === '') return '';
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '" s="' + (style != null ? style : (XF[type] || 0) + (bold ? 1 : 0)) + '"><v>' + v + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr" s="' + (style != null ? style : (bold ? 1 : 0)) + '"><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
      }
      function row(cells) { rows.push('<row r="' + (r + 1) + '">' + cells.join('') + '</row>'); r++; }
      row([cell(0, meta.stationName || 'Gas Station', 'text', true, 12)]);
      if (meta.address) row([cell(0, meta.address, 'text')]);
      row([cell(0, report.title + ' — ' + sec.name, 'text', true)]);
      row([cell(0, 'Period: ' + report.period, 'text')]);
      row([cell(0, 'Generated ' + U.fmtDateTime(Date.now()) + (meta.by ? ' by ' + meta.by : ''), 'text')]);
      r++;
      row(sec.columns.map(function (c, ci) { return cell(ci, c.label, 'text', true); }));
      sec.rows.forEach(function (d) { row(sec.columns.map(function (c, ci) { return cell(ci, d[ci], c.type, false); })); });
      if (sec.totals && sec.rows.length) row(sec.columns.map(function (c, ci) { return cell(ci, sec.totals[ci], c.type, true); }));
      var cols = sec.columns.map(function (c, ci) {
        var w = c.label.length;
        sec.rows.forEach(function (d) { w = Math.max(w, fmt(d[ci], c.type).length); });
        return '<col min="' + (ci + 1) + '" max="' + (ci + 1) + '" width="' + Math.min(50, Math.max(10, w + 4)) + '" customWidth="1"/>';
      }).join('');
      return { name: name, xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>' + cols + '</cols><sheetData>' + rows.join('') + '</sheetData></worksheet>' };
    });
    var H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var fmts = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'];
    [4, 164, 3, 165, 166].forEach(function (id) {
      fmts.push('<xf numFmtId="' + id + '" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>');
      fmts.push('<xf numFmtId="' + id + '" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>');
    });
    fmts.push('<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>');
    var styles = H + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.###"/><numFmt numFmtId="165" formatCode="0.0&quot;%&quot;"/><numFmt numFmtId="166" formatCode="#,##0.0000"/></numFmts>' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + fmts.length + '">' + fmts.join('') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    var files = [
      { name: '[Content_Types].xml', data: H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>' },
      { name: '_rels/.rels', data: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map(function (s, i) { return '<sheet name="' + xml(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: styles }
    ];
    sheets.forEach(function (s, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: s.xml }); });
    return zip(files.map(function (f) { return { name: f.name, data: U.utf8(f.data) }; }));
  }

  // ================================================================== CSV
  function toCsv(report, meta) {
    function q(v) { v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    function val(v, type) {
      if (v == null || v === '') return '';
      if (typeof v !== 'number') return v;
      return type === 'money' ? v.toFixed(2) : type === 'cost' ? v.toFixed(4) : type === 'pct' ? v.toFixed(1) : String(v);
    }
    var lines = [q(meta.stationName || 'Gas Station'), q(report.title), q('Period: ' + report.period), ''];
    report.sections.forEach(function (sec) {
      lines.push(q(sec.name));
      lines.push(sec.columns.map(function (c) { return q(c.label + (c.type === 'pct' ? ' (%)' : '')); }).join(','));
      sec.rows.forEach(function (r) { lines.push(sec.columns.map(function (c, ci) { return q(val(r[ci], c.type)); }).join(',')); });
      if (sec.totals && sec.rows.length) lines.push(sec.columns.map(function (c, ci) { return q(val(sec.totals[ci], c.type)); }).join(','));
      lines.push('');
    });
    return U.utf8('﻿' + lines.join('\r\n'));
  }

  var FORMATS = {
    pdf: { ext: 'pdf', mime: 'application/pdf', make: toPdf, label: 'PDF' },
    xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', make: toXlsx, label: 'Excel' },
    csv: { ext: 'csv', mime: 'text/csv', make: toCsv, label: 'CSV' }
  };
  /** Returns {name, mime, bytes} for a report in the given format ('pdf' | 'xlsx' | 'csv'). */
  function make(report, format, meta, from, to) {
    var f = FORMATS[format];
    var name = report.title.replace(/[^A-Za-z0-9]+/g, '-') + '_' + from + (to !== from ? '_to_' + to : '') + '.' + f.ext;
    return { name: name, mime: f.mime, bytes: f.make(report, meta) };
  }
  return { FORMATS: FORMATS, fmt: fmt, isNum: isNum, make: make, toPdf: toPdf, toXlsx: toXlsx, toCsv: toCsv };
})();
