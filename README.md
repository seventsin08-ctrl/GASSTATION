# Gas Station Manager

An offline Android app for running a gas station: sales, inventory, deliveries, overhead and profit, in Philippine pesos (₱).
Works on tablets (landscape and portrait) and phones, Android 8.0 and above. All data stays on the device.

**Net profit = sales − cost of goods sold − overhead expenses.**

## Install

The signed, ready-to-install app is in [`release/GasStationManager-1.0.0.apk`](release/GasStationManager-1.0.0.apk).

1. Copy the APK to the tablet or phone (USB, Bluetooth, chat app, Google Drive…).
2. Open it. Android asks to allow installing from that source the first time — allow it.
3. Open **Gas Station Manager**. The first account you create is the Owner.

To update later, install a newer APK over the old one. Your data is kept, as long as the new APK is signed with the same key
(see [Signing key](#signing-key)). Export a backup first anyway.

## What it does

| Area | Details |
| --- | --- |
| Accounts | Username and password sign-in. Passwords are stored only as salted PBKDF2-SHA256 hashes. Roles: **Owner** (everything) and **Cashier** (record sales and shifts only — no profit, costs, prices, edits or deletes). The Owner adds, disables and resets passwords for users. Every entry records who made it. Automatic sign-out after inactivity (1–60 minutes). |
| Products | Fuels sold per litre and items sold per piece. Selling price, cost, tank capacity / maximum stock, starting stock, reorder level. Add, edit, archive. |
| Stock | Current stock = starting stock + deliveries − sales ± adjustments. Tank gauge per product, low-stock warnings at the reorder level, adjustments with a reason (dipstick reading, evaporation, spillage, correction). |
| Price history | Every price and cost change is kept. Each sale stores the price and cost it was sold at, so old figures never change. |
| Sales | By litres/pieces **or** by peso amount (“₱500 of diesel”). Total and gross profit shown before saving. Cash, GCash, card, or credit to a customer account. Warning when a sale exceeds stock. |
| Shifts (optional) | Opening and closing pump meter readings and drawer cash; expected vs actual cash and metered vs recorded litres. |
| Deliveries | Product, quantity, cost per unit, supplier, delivery receipt number, date. Adds to stock and updates cost by weighted average. |
| Expenses | Category, amount, date, note. Nine standard categories plus your own. Recurring monthly expenses are posted automatically. |
| Dashboard | Today / last 7 days / this month / custom dates: sales, cost of goods sold, gross profit, overhead, net profit, litres sold, gross margin %, stock value. Charts: daily sales and profit, overhead by category, profit by product. |
| Reports | Daily sales, monthly profit and loss, inventory movement, expenses, sales by user, sales by product. Export to PDF, Excel (.xlsx) and CSV — save to the device or share through any app. |
| Backup | Export everything to one file (save or share). Import with a preview of the file’s contents and a confirmation. Optional automatic daily backup to a folder you choose (keeps the last 30). The file carries a format version; older files are upgraded automatically on import. |
| Other | Owner-only edit and delete with confirmation and an audit log. Search and filter entries by date, type, product, user and text. Station name, address and logo on reports. Large buttons, on-screen number keypad, light and dark mode. |

Notes on a few choices:

- New accounts are created by the Owner (Settings › Users), not from the sign-in screen, so nobody with access to the tablet can make their own account.
- There is no password recovery for the Owner — the app is offline. Create a second Owner account as a spare, and keep backups.
- Credit sales go to **customer accounts**; the Owner records payments against them and sees who owes what.
- The backup file contains all business data and the password hashes. Keep it somewhere safe.
- The app declares the Internet permission only because Android’s WebView needs it to load the app’s own bundled pages.
  `MainActivity` refuses every request that is not a bundled file, so nothing is ever sent or fetched.

## How it is built

The app is a small native Android shell around a bundled, fully offline web app.

```
app/src/main/
  java/com/gasstation/manager/
    MainActivity.java     WebView host + bridge: save/share files, backup folder, safety snapshot
    ShareProvider.java    lets other apps read a file you chose to share
  assets/www/             the app itself (plain HTML/CSS/JavaScript, no frameworks, no build step)
    js/logic.js           all business rules: stock, weighted average cost, profit, reports, shifts
    js/db.js              storage (IndexedDB), settings, backup format + migrations, bridge wrapper
    js/crypto.js          password hashing (PBKDF2-SHA256)
    js/export.js          PDF, Excel and CSV writers
    js/ui.js              dialogs, keypad, forms, charts
    js/app.js             start-up, sign-in, navigation, session timeout, backup import
    js/forms.js           add / edit forms and entry details
    js/views1.js          Overview, Sell, Transactions
    js/views2.js          Inventory, Expenses, Reports, Customers, Shifts, Settings
tests/                    automated browser tests (see below)
tools/gen-assets.js       regenerates js/icons.js and js/pdfmetrics.js
keystore/                 where the signing key goes (not committed)
version.properties        app version (bump versionCode for every release)
```

Data lives in the app’s private storage (IndexedDB inside the WebView), which Android keeps across app updates.
The app also keeps a private safety copy (`snapshot.json`) and restores from it if the main store is ever found empty.
Uninstalling the app or using “Clear storage” deletes everything — export a backup before doing either.

**Changing the data layout later:** bump `VERSION` in the `Backup` section of `js/db.js` and add
`MIGRATIONS[oldVersion] = function (backup) { …; return backup; }`. The same migration upgrades both the data on the
device after an update and older backup files on import.

## Rebuild the APK

You need a JDK (17 or 21) and the Android SDK (platform 34, build-tools 35.0.0 or newer). Either way gives the same signed app.

### Option A — Gradle / Android Studio

Open the folder in Android Studio and run **Build › Generate Signed App Bundle / APK**, or from a terminal:

```bash
export ANDROID_HOME=/path/to/android-sdk      # or put sdk.dir=... in local.properties
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

### Option B — no Gradle

`build.sh` calls the SDK tools directly (aapt2, javac, d8, zipalign, apksigner). It needs no internet.

```bash
export ANDROID_HOME=/path/to/android-sdk
./build.sh
# -> release/GasStationManager-<version>.apk
```

On Debian/Ubuntu it also works with the distribution packages instead of a downloaded SDK:
`sudo apt install aapt zipalign apksigner android-sdk-build-tools android-sdk-platform-23 dalvik-exchange`.

### Releasing an update

1. Raise `versionCode` (and `versionName`) in `version.properties`, and `APP_VERSION` in `app/src/main/assets/www/js/db.js`.
2. Rebuild, then install the new APK over the old one.

### Signing key

Android only installs an update over an existing app when both are signed with the same key. The key that signed
`release/GasStationManager-1.0.0.apk` is **not stored in this repository** — it was delivered separately as two files:

```
keystore/gasstation-release.jks      the key
keystore/keystore.properties         its passwords
```

Keep both somewhere safe (not in a public place) and put them back in `keystore/` whenever you rebuild; both build
options pick them up from there, and `.gitignore` keeps them out of commits. `keystore/keystore.properties.example`
shows the format.

If the key is ever lost, make a new one (`keytool -genkeypair -keystore keystore/gasstation-release.jks -alias gasstation -keyalg RSA -keysize 2048 -validity 10950`)
and move your data across with **Export backup → uninstall → install the new build → Import backup**.

## Tests

The tests drive the real app in Chromium with Playwright (`npm i -g playwright`, plus `pdftotext` and Python `openpyxl` for checking exported files).

```bash
NODE_PATH=$(npm root -g) node tests/e2e.js           # ~70 checks: figures, roles, audit, exports, backup/restore, auto sign-out
NODE_PATH=$(npm root -g) node tests/screenshots.js   # sample data + screenshots of every screen (tablet, portrait, phone; light, dark)
```

You can also open the app in a desktop browser for development: serve `app/src/main/assets/www` with any static web
server (for example `python3 -m http.server --directory app/src/main/assets/www`). Exports then download as normal files.

`tests/device.js` talks to a debug build running on a device or emulator through the WebView debug port (instructions in the file).

### What was verified

- Browser tests: all checks pass.
- On an Android 9 emulator with an old WebView (Chrome 66): install, first-run setup, sales/delivery/expense figures, sign-in,
  data kept after an app restart and after installing an update, Save to device, Share, choosing the backup folder and writing
  an automatic backup into it, importing a backup (file chooser → preview → restore), touch input and the Back button.
- Not tested on a physical tablet or phone.

## Credits

Icons: [Lucide](https://lucide.dev) (ISC licence). Font: Plus Jakarta Sans (SIL Open Font Licence).
