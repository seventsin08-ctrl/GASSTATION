'use strict';
/* Application shell: start-up, sign in / first-run setup, navigation, session timeout, backup import. */
var App = (function () {
  var views = {}, user = null, current = null, lastActivity = Date.now(), fails = 0, lockedUntil = 0, lastWidth = window.innerWidth;
  var NAV = [
    { id: 'dashboard', label: 'Overview', icon: 'home', owner: true },
    { id: 'sell', label: 'Sell', icon: 'sell' },
    { id: 'transactions', label: 'Entries', title: 'Transactions', cashierLabel: 'My sales', icon: 'list' },
    { id: 'inventory', label: 'Stock', title: 'Inventory', icon: 'tank' },
    { id: 'expenses', label: 'Expenses', icon: 'expense', owner: true },
    { id: 'reports', label: 'Reports', icon: 'report', owner: true },
    { id: 'customers', label: 'Credit', title: 'Customer accounts', icon: 'credit', owner: true },
    { id: 'shifts', label: 'Shifts', icon: 'clock' },
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ];
  var root = function () { return document.getElementById('app'); };

  // ------------------------------------------------------------------ theme (per device)
  function themePref() { try { return localStorage.getItem('theme') || 'system'; } catch (e) { return 'system'; } }
  function applyTheme() {
    var p = themePref(), dark = p === 'dark' || (p === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  function setTheme(p) { try { localStorage.setItem('theme', p); } catch (e) { /* ignore */ } applyTheme(); }

  // ------------------------------------------------------------------ start-up
  function boot() {
    applyTheme();
    if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addListener) mq.addListener(applyTheme); }
    DB.open().then(function () { return Backup.recoverFromSnapshot(); }).then(function (recovered) {
      return Backup.upgradeDevice().then(function () { return recovered; });
    }).then(function (recovered) {
      DB.onChange = Backup.markDirty;
      showAuth();
      if (recovered) UI.toast('Your data was recovered from the device safety copy.');
    }).catch(function (e) {
      U.clear(root()).appendChild(h('div.auth', h('div.authcard', h('h1', 'Cannot start'), h('p.lead', 'The app could not open its storage on this device: ' + (e && e.message ? e.message : e)))));
    });
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, function () { lastActivity = Date.now(); }, true); });
    setInterval(tick, 15000);
    window.addEventListener('resize', U.debounce(function () {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      if (user && current && !document.querySelector('.overlay')) refresh();
    }, 200));
    window.__appBack = function () {
      if (UI.back()) return true;
      if (user && current !== home()) { go(home()); return true; }
      return false;
    };
    window.__appPause = function () { Backup.snapshot(true); };
    window.__appResume = function () { tick(); };
  }
  function tick() {
    if (!user) return;
    var mins = Settings.get().autoLogoutMin;
    if (mins > 0 && Date.now() - lastActivity > mins * 60000) { logout('You were signed out after ' + mins + ' minute' + (mins === 1 ? '' : 's') + ' without activity.'); return; }
    Backup.snapshot(false);
    housekeeping();
  }
  /** Things that should happen by themselves: post due recurring expenses, run the daily backup. */
  function housekeeping() {
    L.postRecurring().then(function (n) {
      if (n > 0 && user && user.role === 'owner') { UI.toast(n + ' recurring expense' + (n === 1 ? '' : 's') + ' added automatically'); if (current === 'expenses' || current === 'dashboard') refresh(); }
    }).catch(function () { /* retried on the next tick */ });
    var s = Settings.get();
    if (s.autoBackup && Native.available && s.lastAutoBackup !== U.today() && Native.folder() && !Native.busy()) {
      Native.toBackupFolder(Backup.fileName('GasStation-auto-'), Backup.bytes('automatic backup')).then(function (r) {
        if (r.ok) Settings.save({ lastAutoBackup: U.today(), lastBackupAt: Date.now() });
      });
    }
  }

  // ------------------------------------------------------------------ sign in / first run
  function authCard(children) {
    U.clear(root()).appendChild(h('div.auth', h('div.authcard', h('div.logo', U.icon('sell', 30)), children)));
  }
  function field(label, input, hint) { return h('label.field', h('span.lbl', label), input, hint ? h('span.hint', hint) : null); }
  function errBox() { return h('div.formerr'); }
  function showErr(box, msg) { U.clear(box); if (msg) box.appendChild(h('div.banner.neg', U.icon('alert', 18), h('span', msg))); }

  function showAuth(message) {
    user = null; current = null;
    UI.closeAll();
    if (!DB.data.users.length) return showSetup();
    var s = Settings.get(), err = errBox();
    var un = h('input.input', { type: 'text', placeholder: 'Username', autocapitalize: 'none', autocomplete: 'username', spellcheck: 'false', 'data-field': 'username' });
    var pw = h('input.input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'data-field': 'password' });
    var btn = h('button.btn.primary.lg.block', { type: 'submit' }, 'Sign in');
    function submit(e) {
      e.preventDefault();
      if (Date.now() < lockedUntil) return showErr(err, 'Too many wrong attempts. Try again in ' + Math.ceil((lockedUntil - Date.now()) / 1000) + ' seconds.');
      var name = un.value.trim().toLowerCase();
      var u = DB.data.users.filter(function (x) { return x.username.toLowerCase() === name; })[0];
      if (!name || !pw.value) return showErr(err, 'Enter your username and password.');
      btn.disabled = true;
      (u ? Crypt.verifyPassword(pw.value, u) : Promise.resolve(false)).then(function (ok) {
        btn.disabled = false;
        if (!ok) {
          fails++;
          if (fails >= 5) { fails = 0; lockedUntil = Date.now() + 30000; }
          pw.value = '';
          return showErr(err, 'Wrong username or password.');
        }
        if (u.disabled) return showErr(err, 'This account has been disabled. Ask the Owner to enable it.');
        fails = 0;
        login(u);
      });
    }
    authCard([h('h1', s.stationName), h('p.lead', 'Sign in to continue.'),
      message ? h('div.banner.info', { style: { marginBottom: '14px' } }, U.icon('info', 18), h('span', message)) : null,
      h('form.stack', { onsubmit: submit }, field('Username', un), field('Password', pw), err, btn),
      h('p.tiny.muted.center', { style: { marginTop: '18px' } }, 'New accounts are added by the Owner in Settings › Users.')]);
  }

  function showSetup() {
    var err = errBox(), seed = true;
    function inp(key, type, ph, caps) { return h('input.input', { type: type, placeholder: ph, 'data-field': key, autocapitalize: caps || 'none', autocomplete: 'off', spellcheck: 'false' }); }
    var station = inp('station', 'text', 'e.g. Santos Fuel Station', 'words'), name = inp('name', 'text', 'Your name', 'words'), un = inp('username', 'text', 'Choose a username'),
      pw = inp('password', 'password', 'At least 6 characters'), pw2 = inp('password2', 'password', 'Type it again');
    var check = h('button.check.on', { type: 'button', onclick: function () { seed = !seed; check.className = 'check' + (seed ? ' on' : ''); } }, h('span.box', U.icon('check', 17)),
      h('span', 'Add starter products (Unleaded 91, Premium 95, Diesel, Engine Oil). You set the prices and stock next.'));
    var btn = h('button.btn.primary.lg.block', { type: 'submit' }, 'Create Owner account');
    function submit(e) {
      e.preventDefault();
      var v = { station: station.value.trim(), name: name.value.trim(), username: un.value.trim(), pw: pw.value };
      try {
        if (!v.station) throw new Error('Enter your station name.');
        checkUserInput(v.username, v.pw, pw2.value, null);
      } catch (ex) { return showErr(err, ex.message); }
      btn.disabled = true;
      Crypt.hashPassword(v.pw).then(function (hp) {
        var u = { id: U.uid(), username: v.username, displayName: v.name || v.username, role: 'owner', salt: hp.salt, hash: hp.hash, iter: hp.iter, disabled: false, createdAt: Date.now() };
        return DB.put('users', u).then(function () { return DB.setMeta('schemaVersion', Backup.VERSION); })
          .then(function () { return Settings.save({ stationName: v.station }); })
          .then(function () { return L.seedCategories(); })
          .then(function () {
            if (!seed) return;
            var starters = [['Unleaded 91', 'L', 20000, 5000], ['Premium 95', 'L', 20000, 5000], ['Diesel', 'L', 20000, 5000], ['Engine Oil 1L', 'pc', 100, 10]];
            return starters.reduce(function (p, x) {
              return p.then(function () { return L.createProduct({ name: x[0], unit: x[1], price: 0, cost: 0, capacity: x[2], startingStock: 0, reorderLevel: x[3] }, u); });
            }, Promise.resolve());
          }).then(function () { return L.audit(u, 'create', 'user', u.id, 'Created Owner account ' + u.username); })
          .then(function () { login(u, seed ? 'inventory' : null); });
      }).catch(function (ex) { btn.disabled = false; showErr(err, ex.message || String(ex)); });
    }
    authCard([h('h1', 'Set up your station'), h('p.lead', 'Create the Owner account. Everything stays on this device and works without internet.'),
      h('form.stack', { onsubmit: submit }, field('Station name', station), field('Your name', name), field('Username', un), field('Password', pw), field('Confirm password', pw2), check, err, btn),
      h('div.center', { style: { marginTop: '8px' } }, h('button.link', { type: 'button', onclick: function () { importBackup(); } }, 'Restore from a backup file instead'))]);
  }

  /** Shared validation for new users and password changes. `existingId` is skipped in the duplicate check. */
  function checkUserInput(username, pw, pw2, existingId) {
    if (username != null) {
      if (!/^[A-Za-z0-9._-]{3,20}$/.test(username)) throw new Error('Username must be 3–20 letters, numbers, dots, dashes or underscores.');
      if (DB.data.users.some(function (x) { return x.id !== existingId && x.username.toLowerCase() === username.toLowerCase(); })) throw new Error('That username is already taken.');
    }
    if (pw != null) {
      if (pw.length < 6) throw new Error('Password must be at least 6 characters.');
      if (pw2 != null && pw !== pw2) throw new Error('The two passwords do not match.');
    }
  }

  function login(u, startView) {
    user = u; lastActivity = Date.now();
    renderShell();
    go(startView || home());
    housekeeping();
  }
  function logout(message) {
    Backup.snapshot(true);
    showAuth(message);
  }
  function isOwner() { return !!user && user.role === 'owner'; }
  function home() { return isOwner() ? 'dashboard' : 'sell'; }

  // ------------------------------------------------------------------ shell and navigation
  function navItems() { return NAV.filter(function (n) { return !n.owner || isOwner(); }); }
  function navLabel(n) { return (!isOwner() && n.cashierLabel) || n.label; }
  function renderShell() {
    var items = navItems();
    function btn(n) { return h('button.nav', { type: 'button', 'data-nav': n.id, 'aria-label': navLabel(n), onclick: function () { go(n.id); } }, U.icon(n.icon, 22), navLabel(n)); }
    var phoneItems = items.length > 5 ? items.slice(0, 4) : items;
    U.clear(root()).appendChild(h('div.shell',
      h('aside.rail', h('div.logo', U.icon('sell', 26)), items.slice(0, -1).map(btn), h('div.spacer'), btn(items[items.length - 1])),
      h('main.panel',
        h('header.topbar', h('h1.ell', { id: 'title' }), h('div.row', { id: 'actions' }),
          h('button.userchip', { type: 'button', 'aria-label': 'Account', onclick: accountMenu }, h('span.avatar' + (isOwner() ? '.owner' : ''), U.initials(user.displayName || user.username)), h('span.uname.ell', user.displayName || user.username))),
        h('div.view', { id: 'view' })),
      h('nav.bottomnav', phoneItems.map(btn), items.length > 5 ? h('button.nav', { type: 'button', 'data-nav': 'more', onclick: moreMenu }, U.icon('more', 22), 'More') : null)));
  }
  function moreMenu() {
    var m = UI.modal({ title: 'More', body: h('div.list', navItems().slice(4).map(function (n) {
      return UI.item({ icon: n.icon, tone: 'sky', title: n.title || n.label, sub: '', right: U.icon('right', 18) }, function () { m.close(); go(n.id); });
    })) });
  }
  function go(id, params) {
    var n = NAV.filter(function (x) { return x.id === id; })[0];
    if (!n || (n.owner && !isOwner())) { id = home(); n = NAV.filter(function (x) { return x.id === id; })[0]; }
    current = id;
    if (views[id].enter) views[id].enter(params || {});
    refresh(true);
  }
  function refresh(resetScroll) {
    if (!user || !current) return;
    var n = NAV.filter(function (x) { return x.id === current; })[0], view = document.getElementById('view'), top = view.scrollTop;
    document.getElementById('title').textContent = (!isOwner() && n.cashierLabel) || n.title || n.label;
    U.clear(document.getElementById('actions'));
    var inMore = navItems().slice(4).some(function (x) { return x.id === current; }) && navItems().length > 5;
    Array.prototype.forEach.call(document.querySelectorAll('.nav'), function (b) {
      var id = b.getAttribute('data-nav'), bottom = b.parentNode.className === 'bottomnav';
      b.className = 'nav' + ((id === current || (bottom && id === 'more' && inMore)) ? ' on' : '');
    });
    U.clear(view);
    try { views[current].render(view); } catch (e) { view.appendChild(UI.empty('alert', 'Something went wrong', e.message)); if (window.console) console.error(e); }
    view.scrollTop = resetScroll ? 0 : top;
  }
  function setActions(nodes) { var a = document.getElementById('actions'); U.clear(a); U.append(a, nodes); }

  function accountMenu() {
    var m = UI.modal({ title: user.displayName || user.username, size: 'narrow', body: h('div.stack',
      h('div.row', h('span.chip', isOwner() ? 'Owner' : 'Cashier'), h('span.muted.small', '@' + user.username)),
      h('div', h('div.lbl.small.b.muted', { style: { marginBottom: '7px' } }, 'Appearance'),
        UI.seg([{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'system', label: 'Auto' }], themePref(), setTheme)),
      h('button.btn.block', { type: 'button', onclick: function () { m.close(); changePassword(); } }, U.icon('key', 18), 'Change my password'),
      h('button.btn.primary.block', { type: 'button', 'data-act': 'signout', onclick: function () { m.close(); logout(); } }, U.icon('logout', 18), 'Sign out')) });
  }
  function changePassword() {
    UI.form({ title: 'Change my password', columns: 1, submit: 'Change password',
      fields: [{ key: 'old', label: 'Current password', type: 'password' }, { key: 'pw', label: 'New password', type: 'password', hint: 'At least 6 characters' }, { key: 'pw2', label: 'Confirm new password', type: 'password' }],
      onSubmit: function (v) {
        return Crypt.verifyPassword(v.old, user).then(function (ok) {
          if (!ok) throw new Error('Your current password is not correct.');
          checkUserInput(null, v.pw, v.pw2);
          return Crypt.hashPassword(v.pw);
        }).then(function (hp) {
          user.salt = hp.salt; user.hash = hp.hash; user.iter = hp.iter;
          return DB.put('users', user);
        }).then(function () { return L.audit(user, 'edit', 'user', user.id, 'Changed own password'); }).then(function () { UI.toast('Password changed'); });
      } });
  }

  // ------------------------------------------------------------------ backup import (also used on the first-run screen)
  function pickFile(accept, cb) {
    var inp = h('input', { type: 'file', accept: accept, style: { display: 'none' } });
    inp.addEventListener('change', function () { var f = inp.files && inp.files[0]; if (inp.parentNode) inp.parentNode.removeChild(inp); if (f) cb(f); });
    document.body.appendChild(inp);
    inp.click();
  }
  function importBackup() {
    pickFile('.json,application/json,application/octet-stream,text/plain', function (file) {
      var r = new FileReader();
      r.onerror = function () { UI.alert('Cannot read file', 'The selected file could not be read.'); };
      r.onload = function () {
        var parsed;
        try { parsed = Backup.parse(String(r.result)); } catch (e) { return UI.alert('Cannot import', e.message); }
        previewBackup(parsed, file.name);
      };
      r.readAsText(file);
    });
  }
  function previewBackup(parsed, fileName) {
    var i = parsed.info, hasData = DB.data.users.length > 0;
    UI.modal({ title: 'Restore this backup?', body: h('div.stack',
      UI.dl([['File', fileName], ['Station', i.stationName || '—'], ['Backup made', i.createdAt ? U.fmtDateTime(new Date(i.createdAt).getTime()) : '—'],
        ['App version', i.appVersion || '—'], ['Data format', 'Version ' + i.version + (i.migrated ? ' (will be upgraded automatically)' : '')],
        ['Sales dates', i.salesFrom ? U.fmtDate(i.salesFrom) + ' – ' + U.fmtDate(i.salesTo) : 'No sales'], ['Accounts', i.users.join(', ')]]),
      h('div.card', { style: { padding: '14px 16px' } }, UI.dl(i.counts.map(function (c) { return [c.label, U.num(c.count, 0)]; }))),
      hasData ? h('div.banner.neg', U.icon('alert', 18), h('span', 'Restoring replaces ALL data now on this device with the contents of this file. This cannot be undone.'))
        : h('div.banner.info', U.icon('info', 18), h('span', 'After restoring, sign in with an account from the backup.'))),
      actions: [{ label: 'Cancel', onClick: function (m) { m.close(); } },
        { label: hasData ? 'Replace all data' : 'Restore backup', kind: hasData ? 'danger' : 'primary', onClick: function (m, btn) {
          btn.disabled = true;
          var by = user;
          Backup.restore(parsed.data).then(function () {
            return L.audit(by && DB.get('users', by.id) ? by : null, 'restore', 'backup', '', 'Restored backup file ' + fileName + ' (made ' + (i.createdAt || 'unknown date') + ')');
          }).then(function () {
            m.close();
            logout('Backup restored. Sign in with an account from the backup.');
          }).catch(function (e) { btn.disabled = false; UI.alert('Restore failed', 'Nothing was changed. ' + (e && e.message ? e.message : e)); });
        } }] });
  }

  return {
    boot: boot, view: function (id, v) { views[id] = v; }, go: go, refresh: refresh, setActions: setActions, user: function () { return user; }, isOwner: isOwner,
    logout: logout, checkUserInput: checkUserInput, importBackup: importBackup, pickFile: pickFile, themePref: themePref, setTheme: setTheme, changePassword: changePassword, current: function () { return current; }
  };
})();
