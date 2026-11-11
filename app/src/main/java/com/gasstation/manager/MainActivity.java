package com.gasstation.manager;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Hosts the offline web app (assets/www) in a WebView and exposes a small bridge for
 * things a web page cannot do on its own: saving/sharing files, the auto-backup folder,
 * and an internal safety snapshot of the database.
 *
 * The app is served from a fixed https origin that never leaves the device, so the
 * WebView's IndexedDB storage keeps the same origin across app updates.
 */
public class MainActivity extends Activity {
    static final String TAG = "GasStation";
    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/index.html";
    static final String AUTO_PREFIX = "GasStation-auto-";
    static final int KEEP_AUTO_BACKUPS = 30;

    private static final int REQ_FILE_CHOOSER = 1;
    private static final int REQ_SAVE = 2;
    private static final int REQ_TREE = 3;

    private WebView web;
    private ValueCallback<Uri[]> fileChooserCallback;
    private int pendingSaveCb = -1;
    private int pendingTreeCb = -1;
    private final Object fileLock = new Object();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Debug builds only: allow inspecting the page from Chrome on a computer (chrome://inspect).
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(0xFF141418);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new ChromeClient());

        if (savedInstanceState == null) {
            web.loadUrl(START_URL);
        } else {
            web.restoreState(savedInstanceState);
            if (web.getUrl() == null) web.loadUrl(START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        js("window.__appPause && window.__appPause()");
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        js("window.__appResume && window.__appResume()");
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.__appBack && window.__appBack()) ? 'handled' : 'no'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (value == null || !value.contains("handled")) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("AndroidBridge");
            web.destroy();
        }
        super.onDestroy();
    }

    private void js(final String code) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (web != null) web.evaluateJavascript(code, null);
                } catch (Throwable t) {
                    Log.w(TAG, "js call failed", t);
                }
            }
        });
    }

    /** Reports the outcome of an asynchronous bridge call back to the page. */
    private void callback(int id, boolean ok, String message) {
        if (id < 0) return;
        js("window.__nativeResult && window.__nativeResult(" + id + "," + ok + "," + JSONObject.quote(message == null ? "" : message) + ")");
    }

    // ---------------------------------------------------------------- local asset serving

    private static final Map<String, String> MIME = new HashMap<String, String>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("woff2", "font/woff2");
        MIME.put("ico", "image/x-icon");
    }

    private class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if ("data".equals(scheme) || "blob".equals(scheme) || "about".equals(scheme)) return null;
            if ("https".equals(scheme) && HOST.equals(uri.getHost())) {
                String path = uri.getPath();
                if (path == null || path.length() == 0 || "/".equals(path)) path = "/index.html";
                if (!path.contains("..")) {
                    try {
                        InputStream in = getAssets().open("www" + path);
                        int dot = path.lastIndexOf('.');
                        String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase() : "";
                        String mime = MIME.get(ext);
                        if (mime == null) mime = "application/octet-stream";
                        boolean text = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg");
                        WebResourceResponse r = new WebResourceResponse(mime, text ? "UTF-8" : null, in);
                        Map<String, String> headers = new HashMap<String, String>();
                        headers.put("Cache-Control", "no-cache");
                        r.setResponseHeaders(headers);
                        return r;
                    } catch (Exception e) {
                        Log.w(TAG, "asset not found: " + path);
                    }
                }
            }
            // Everything else is refused: the app never talks to the network.
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }

        // Navigation away from the bundled app is blocked. (No @Override on the first overload so the
        // class also compiles against platform jars older than API 24; it still overrides at runtime.)
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !isLocal(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !isLocal(Uri.parse(url));
        }

        private boolean isLocal(Uri uri) {
            return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost());
        }
    }

    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = callback;
            try {
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                String[] types = params.getAcceptTypes();
                boolean image = types != null && types.length > 0 && types[0] != null && types[0].startsWith("image");
                i.setType(image ? "image/*" : "*/*");
                startActivityForResult(Intent.createChooser(i, image ? "Choose image" : "Choose backup file"), REQ_FILE_CHOOSER);
                return true;
            } catch (Exception e) {
                fileChooserCallback = null;
                return false;
            }
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            return true;
        }
    }

    // ---------------------------------------------------------------- activity results

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileChooserCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{data.getData()};
                fileChooserCallback.onReceiveValue(result);
                fileChooserCallback = null;
            }
        } else if (requestCode == REQ_SAVE) {
            final int cb = pendingSaveCb;
            pendingSaveCb = -1;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                callback(cb, false, "cancelled");
                return;
            }
            final Uri target = data.getData();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        synchronized (fileLock) {
                            copyTempTo(getContentResolver().openOutputStream(target));
                        }
                        callback(cb, true, displayName(target));
                    } catch (Throwable t) {
                        Log.e(TAG, "save failed", t);
                        callback(cb, false, String.valueOf(t.getMessage()));
                    }
                }
            }).start();
        } else if (requestCode == REQ_TREE) {
            int cb = pendingTreeCb;
            pendingTreeCb = -1;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                callback(cb, false, "cancelled");
                return;
            }
            try {
                Uri tree = data.getData();
                getContentResolver().takePersistableUriPermission(tree,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                prefs().edit().putString("backupTree", tree.toString()).apply();
                callback(cb, true, folderLabel(tree));
            } catch (Throwable t) {
                Log.e(TAG, "folder pick failed", t);
                callback(cb, false, String.valueOf(t.getMessage()));
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    private SharedPreferences prefs() {
        return getSharedPreferences("gasstation", MODE_PRIVATE);
    }

    private File tempFile() {
        return new File(getCacheDir(), "outgoing.tmp");
    }

    private File snapshotFile() {
        return new File(getFilesDir(), "snapshot.json");
    }

    private void copyTempTo(OutputStream out) throws Exception {
        if (out == null) throw new Exception("Cannot open the destination for writing");
        InputStream in = new FileInputStream(tempFile());
        try {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
        } finally {
            in.close();
            out.close();
        }
    }

    private static void copyFile(File from, File to) throws Exception {
        InputStream in = new FileInputStream(from);
        OutputStream out = new FileOutputStream(to);
        try {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
        } finally {
            in.close();
            out.close();
        }
    }

    private String displayName(Uri uri) {
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, new String[]{"_display_name"}, null, null, null);
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null) return n;
            }
        } catch (Throwable ignored) {
        } finally {
            if (c != null) c.close();
        }
        return "file";
    }

    private String folderLabel(Uri tree) {
        try {
            String id = DocumentsContract.getTreeDocumentId(tree);
            int colon = id.indexOf(':');
            String tail = colon >= 0 ? id.substring(colon + 1) : id;
            return tail.length() == 0 ? "Device storage" : tail;
        } catch (Throwable t) {
            return "Selected folder";
        }
    }

    private static String safeName(String name) {
        String n = name == null ? "file" : name.replaceAll("[^A-Za-z0-9._ -]", "_");
        return n.length() == 0 ? "file" : n;
    }

    /** Deletes the oldest automatic backups so the folder does not grow without limit. */
    private void pruneAutoBackups(Uri tree) {
        Cursor c = null;
        try {
            ContentResolver cr = getContentResolver();
            String parentId = DocumentsContract.getTreeDocumentId(tree);
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
            c = cr.query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null);
            if (c == null) return;
            List<String[]> autos = new ArrayList<String[]>();
            while (c.moveToNext()) {
                String name = c.getString(1);
                if (name != null && name.startsWith(AUTO_PREFIX)) autos.add(new String[]{name, c.getString(0)});
            }
            Collections.sort(autos, new java.util.Comparator<String[]>() {
                @Override
                public int compare(String[] a, String[] b) {
                    return b[0].compareTo(a[0]);
                }
            });
            for (int i = KEEP_AUTO_BACKUPS; i < autos.size(); i++) {
                DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, autos.get(i)[1]));
            }
        } catch (Throwable t) {
            Log.w(TAG, "prune failed", t);
        } finally {
            if (c != null) c.close();
        }
    }

    // ---------------------------------------------------------------- JavaScript bridge

    /** Methods here are called from the page on a background thread. */
    private class Bridge {
        private OutputStream out;

        @JavascriptInterface
        public String appVersion() {
            try {
                PackageInfo p = getPackageManager().getPackageInfo(getPackageName(), 0);
                return p.versionName;
            } catch (Throwable t) {
                return "";
            }
        }

        /** Starts a new outgoing file. Follow with fileAppend() calls, then one of the file*() actions. */
        @JavascriptInterface
        public boolean fileBegin() {
            synchronized (fileLock) {
                try {
                    if (out != null) {
                        try {
                            out.close();
                        } catch (Throwable ignored) {
                        }
                    }
                    out = new FileOutputStream(tempFile(), false);
                    return true;
                } catch (Throwable t) {
                    Log.e(TAG, "fileBegin", t);
                    out = null;
                    return false;
                }
            }
        }

        @JavascriptInterface
        public boolean fileAppend(String base64Chunk) {
            synchronized (fileLock) {
                try {
                    if (out == null) return false;
                    out.write(Base64.decode(base64Chunk, Base64.DEFAULT));
                    return true;
                } catch (Throwable t) {
                    Log.e(TAG, "fileAppend", t);
                    return false;
                }
            }
        }

        private boolean finish() {
            try {
                if (out != null) {
                    out.flush();
                    out.close();
                }
                out = null;
                return true;
            } catch (Throwable t) {
                out = null;
                return false;
            }
        }

        /** Lets the user choose where to save the file (system "Save as" screen). */
        @JavascriptInterface
        public void fileSaveAs(final String name, final String mime, final int cb) {
            synchronized (fileLock) {
                if (!finish()) {
                    callback(cb, false, "Could not prepare the file");
                    return;
                }
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        i.addCategory(Intent.CATEGORY_OPENABLE);
                        i.setType(mime);
                        i.putExtra(Intent.EXTRA_TITLE, safeName(name));
                        pendingSaveCb = cb;
                        startActivityForResult(i, REQ_SAVE);
                    } catch (Throwable t) {
                        pendingSaveCb = -1;
                        callback(cb, false, "No file manager available on this device");
                    }
                }
            });
        }

        /** Shares the file through any installed app (email, Drive, Messenger, Bluetooth...). */
        @JavascriptInterface
        public void fileShare(final String name, final String mime, final int cb) {
            try {
                final File target;
                synchronized (fileLock) {
                    if (!finish()) throw new Exception("Could not prepare the file");
                    File dir = new File(getCacheDir(), "share");
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not create share folder");
                    File[] old = dir.listFiles();
                    if (old != null) for (File f : old) f.delete();
                    target = new File(dir, safeName(name));
                    copyFile(tempFile(), target);
                }
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Uri uri = new Uri.Builder().scheme("content").authority(ShareProvider.authority(MainActivity.this))
                                    .appendPath(target.getName()).build();
                            Intent i = new Intent(Intent.ACTION_SEND);
                            i.setType(mime);
                            i.putExtra(Intent.EXTRA_STREAM, uri);
                            i.putExtra(Intent.EXTRA_SUBJECT, target.getName());
                            i.setClipData(ClipData.newRawUri(target.getName(), uri));
                            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            startActivity(Intent.createChooser(i, "Share " + target.getName()));
                            callback(cb, true, target.getName());
                        } catch (Throwable t) {
                            callback(cb, false, "No app available to share with");
                        }
                    }
                });
            } catch (Throwable t) {
                Log.e(TAG, "fileShare", t);
                callback(cb, false, String.valueOf(t.getMessage()));
            }
        }

        /** Writes the file into the chosen auto-backup folder. */
        @JavascriptInterface
        public void fileToBackupFolder(final String name, final int cb) {
            try {
                String treeStr = prefs().getString("backupTree", null);
                if (treeStr == null) throw new Exception("No backup folder chosen");
                Uri tree = Uri.parse(treeStr);
                synchronized (fileLock) {
                    if (!finish()) throw new Exception("Could not prepare the file");
                    ContentResolver cr = getContentResolver();
                    Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                    Uri doc = DocumentsContract.createDocument(cr, parent, "application/json", safeName(name));
                    if (doc == null) throw new Exception("Could not create the file in the backup folder");
                    copyTempTo(cr.openOutputStream(doc));
                }
                if (name != null && name.startsWith(AUTO_PREFIX)) pruneAutoBackups(tree);
                callback(cb, true, folderLabel(tree));
            } catch (Throwable t) {
                Log.e(TAG, "fileToBackupFolder", t);
                callback(cb, false, String.valueOf(t.getMessage()));
            }
        }

        /** Stores the file as the internal safety snapshot (private app storage). */
        @JavascriptInterface
        public boolean fileToSnapshot() {
            synchronized (fileLock) {
                try {
                    if (!finish()) return false;
                    File tmp = new File(getFilesDir(), "snapshot.json.new");
                    copyFile(tempFile(), tmp);
                    File dest = snapshotFile();
                    if (!tmp.renameTo(dest)) {
                        dest.delete();
                        if (!tmp.renameTo(dest)) return false;
                    }
                    return true;
                } catch (Throwable t) {
                    Log.e(TAG, "fileToSnapshot", t);
                    return false;
                }
            }
        }

        @JavascriptInterface
        public String snapshotRead() {
            try {
                File f = snapshotFile();
                if (!f.exists()) return "";
                InputStream in = new FileInputStream(f);
                try {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream((int) Math.max(1024, f.length()));
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                    return bos.toString("UTF-8");
                } finally {
                    in.close();
                }
            } catch (Throwable t) {
                Log.e(TAG, "snapshotRead", t);
                return "";
            }
        }

        @JavascriptInterface
        public void pickBackupFolder(final int cb) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                        pendingTreeCb = cb;
                        startActivityForResult(i, REQ_TREE);
                    } catch (Throwable t) {
                        pendingTreeCb = -1;
                        callback(cb, false, "No file manager available on this device");
                    }
                }
            });
        }

        /** Returns the label of the chosen auto-backup folder, or "" if none is set or access was lost. */
        @JavascriptInterface
        public String backupFolder() {
            try {
                String treeStr = prefs().getString("backupTree", null);
                if (treeStr == null) return "";
                Uri tree = Uri.parse(treeStr);
                for (android.content.UriPermission p : getContentResolver().getPersistedUriPermissions()) {
                    if (p.getUri().equals(tree) && p.isWritePermission()) return folderLabel(tree);
                }
                return "";
            } catch (Throwable t) {
                return "";
            }
        }

        @JavascriptInterface
        public void clearBackupFolder() {
            try {
                String treeStr = prefs().getString("backupTree", null);
                if (treeStr != null) {
                    try {
                        getContentResolver().releasePersistableUriPermission(Uri.parse(treeStr),
                                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    } catch (Throwable ignored) {
                    }
                }
                prefs().edit().remove("backupTree").apply();
            } catch (Throwable ignored) {
            }
        }
    }
}
