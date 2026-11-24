package io.github.akgazii.gaziclient; 

import android.app.Activity;  
import android.content.Intent;  
import android.net.Uri; 
import android.os.Bundle; 
import android.os.Handler; 
import android.os.Looper; 
import android.view.View;
import android.view.WindowManager;  
import android.webkit.CookieManager; 
import android.webkit.JavascriptInterface;  
import android.webkit.ValueCallback;  
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest; 
import android.webkit.WebResourceResponse;  
import android.webkit.WebSettings; 
import android.webkit.WebStorage;  
import android.webkit.WebView;  
import android.webkit.WebViewClient; 

import org.json.JSONArray;  
import org.json.JSONObject;  

import java.io.ByteArrayInputStream; 
import java.io.ByteArrayOutputStream; 
import java.io.File;  
import java.io.FileOutputStream;  
import java.io.InputStream;
import java.net.HttpURLConnection;  
import java.net.URL;
import java.nio.charset.StandardCharsets; 
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;  
import java.util.HashMap;
import java.util.Iterator;  
import java.util.List;
import java.util.Locale; 
import java.util.Map; 
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * GaziClient for Android. The game runs in a WebView and gets the exact same init script as the
 * desktop client (exported from the exe by build.ps1). This class is the Android side of the IPC:
 * it answers the same commands the Rust host answers, minus the desktop-only ones.
 */
public class MainActivity extends Activity
{ 
    private static final String GAME = "https://deeeep.io/"; 
    private static final String INIT_PATH = "/__gazi/init.js";  
    private static final int PICK_FILES = 7;

    private WebView web; 
    private final Handler ui = new Handler(Looper.getMainLooper());  
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private byte[] initJs;  
    private JSONObject bootStatic;  
    private JSONObject config;  
    private JSONObject pluginData; 
    private final List<String> blockedHosts = new ArrayList<>();  
    private File customDir;
    private File savesDir; 
    // Only the deeeep.io page itself gets this token, so ad frames cannot talk to the bridge.
    private final String token = randomToken(); 
    private ValueCallback<Uri[]> pendingFiles;  

    @Override
    protected void onCreate(Bundle saved)
    {
        super.onCreate(saved);  
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); 
        hideSystemBars();  
        try
        { 
            initJs = readAsset("init.js");
            bootStatic = new JSONObject(new String(readAsset("boot.json"), StandardCharsets.UTF_8)); 
            JSONArray hosts = bootStatic.optJSONArray("blockedHosts");  
            for(int i = 0;hosts != null && i<hosts.length();i++) 
            {  
                blockedHosts.add(hosts.getString(i));  
            } 
        }  
        catch (Exception error) 
        { 
            throw new RuntimeException("GaziClient assets missing", error);
        }  
        customDir = new File(getFilesDir(), "custom"); 
        customDir.mkdirs(); 
        File external = getExternalFilesDir("saves");  
        savesDir = external != null ? external : new File(getFilesDir(), "saves"); 
        loadStore(); 

        web = new WebView(this); 
        setContentView(web); 
        WebSettings settings = web.getSettings(); 
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); 
        settings.setDatabaseEnabled(true);  
        settings.setMediaPlaybackRequiresUserGesture(false);  
        settings.setUseWideViewPort(true); 
        settings.setLoadWithOverviewMode(true); 
        settings.setSupportZoom(false); 
        settings.setTextZoom(100); 
        CookieManager.getInstance().setAcceptCookie(true);  
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "GaziNative");
        web.setWebViewClient(new GameClient());
        web.setWebChromeClient(new ChromeClient()); 
        web.loadUrl(GAME);  
    }

    @Override
    public void onWindowFocusChanged(boolean focus)  
    { 
        super.onWindowFocusChanged(focus);
        if (focus)
        {  
            hideSystemBars();
        }
    } 

    @Override
    public void onBackPressed()  
    {  
        if (web != null && web.canGoBack()) 
        {  
            web.goBack();  
            return; 
        } 
        moveTaskToBack(true);  
    }  

    @Override
    protected void onPause()  
    { 
        super.onPause();  
        CookieManager.getInstance().flush();  
    } 

    @SuppressWarnings("deprecation") 
    private void hideSystemBars() 
    { 
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);  
    } 

    // ---- storage ----

    private void loadStore()
    {  
        config = new JSONObject();  
        try
        {  
            JSONObject defaults = bootStatic.getJSONObject("defaults");
            merge(config, defaults);
            JSONObject savedConfig = readJson(new File(getFilesDir(), "config.json"));  
            if (savedConfig != null) 
            {  
                merge(config, savedConfig);
            } 
        } 
        catch (Exception ignored)  
        {  
        } 
        pluginData = readJson(new File(getFilesDir(), "plugin-data.json"));
        if (pluginData == null)  
        { 
            pluginData = new JSONObject(); 
        }  
    } 

    private static void merge(JSONObject target, JSONObject source)
    {  
        Iterator<String> keys = source.keys();
        while (keys.hasNext())  
        {
            String key = keys.next(); 
            try
            {  
                target.put(key, source.get(key));
            }
            catch (Exception ignored) 
            {
            } 
        }
    }  

    private static JSONObject readJson(File file) 
    { 
        try
        {  
            if (!file.exists()) 
            { 
                return null;
            } 
            return new JSONObject(new String(readAll(new java.io.FileInputStream(file)), StandardCharsets.UTF_8)); 
        } 
        catch (Exception error) 
        {  
            return null;  
        } 
    } 

    private static boolean writeFile(File file, String text)
    { 
        File tmp = new File(file.getPath() + ".tmp"); 
        try
        {  
            File parent = file.getParentFile(); 
            if (parent != null)  
            {  
                parent.mkdirs();
            } 
            FileOutputStream out = new FileOutputStream(tmp);  
            out.write(text.getBytes(StandardCharsets.UTF_8)); 
            out.close();  
            return tmp.renameTo(file) || (file.delete() && tmp.renameTo(file));  
        } 
        catch (Exception error)
        {  
            return false;  
        } 
    } 

    private void saveConfig()
    {  
        writeFile(new File(getFilesDir(), "config.json"), config.toString());  
    }  

    private void savePluginData() 
    {
        writeFile(new File(getFilesDir(), "plugin-data.json"), pluginData.toString());  
    }  

    // ---- plugins ----

    private static String headerValue(String code, String tag)
    { 
        String marker = "@" + tag; 
        String[] lines = code.split("\n", 41); 
        for(int i = 0;i<lines.length && i<40;i++)
        { 
            String line = lines[i].trim();  
            if (!line.startsWith("//")) 
            {  
                continue;  
            }  
            String rest = line.replaceFirst("^/+", "").trim();  
            if (rest.startsWith(marker))
            { 
                String value = rest.substring(marker.length());  
                if (value.isEmpty() || value.startsWith(" ") || value.startsWith("\t")) 
                { 
                    return value.trim();  
                }  
            } 
        }
        return "";
    }

    private static JSONObject customInfo(String fileName, String code) throws Exception
    {  
        String stem = fileName.replaceFirst("\\.js$", ""); 
        String id = headerValue(code, "id"); 
        if (id.isEmpty())
        {
            id = stem;
        }  
        String name = headerValue(code, "name"); 
        if (name.isEmpty())  
        {  
            name = id; 
        }  
        JSONArray tags = new JSONArray(); 
        for (String tag : headerValue(code, "tags").split(",")) 
        {  
            if (!tag.trim().isEmpty()) 
            {
                tags.put(tag.trim()); 
            }  
        } 
        JSONObject info = new JSONObject(); 
        info.put("key", "custom-plugins/" + fileName); 
        info.put("id", id);
        info.put("name", name);
        info.put("description", headerValue(code, "description")); 
        info.put("author", headerValue(code, "author")); 
        info.put("tags", tags);
        info.put("version", ""); 
        info.put("source", "custom");
        info.put("code", code);
        return info;  
    }  

    private JSONArray pluginList() throws Exception
    { 
        List<JSONObject> list = new ArrayList<>(); 
        JSONArray shipped = bootStatic.getJSONArray("plugins");
        for(int i = 0;i<shipped.length();i++) 
        {
            list.add(shipped.getJSONObject(i));
        } 
        File[] files = customDir.listFiles();
        if (files != null)  
        { 
            for (File file : files)  
            {  
                if (file.getName().endsWith(".js")) 
                {  
                    String code = new String(readAll(new java.io.FileInputStream(file)), StandardCharsets.UTF_8); 
                    list.add(customInfo(file.getName(), code));
                }  
            }  
        } 
        Collections.sort(list, (a, b) -> a.optString("name").toLowerCase(Locale.ROOT).compareTo(b.optString("name").toLowerCase(Locale.ROOT)));  
        JSONArray result = new JSONArray();  
        for (JSONObject info : list)
        {
            result.put(info);
        }
        return result;
    } 

    private static String cleanName(String name) 
    {  
        return name.replaceAll("[/\\\\:*?\"<>|]", "").replaceAll("^\\.+|\\.+$", "").trim();
    }  

    // ---- IPC: same commands as the Rust host ----

    private class Bridge
    {  
        @JavascriptInterface
        public void postMessage(String secret, String message) 
        {  
            if (!token.equals(secret))  
            {
                return; 
            } 
            worker.execute(() -> handle(message)); 
        } 
    }  

    private void handle(String message) 
    {  
        long id = 0;  
        try
        {
            JSONObject request = new JSONObject(message);  
            id = request.optLong("id", 0);  
            String cmd = request.optString("cmd"); 
            JSONObject args = request.optJSONObject("args");  
            if (args == null) 
            { 
                args = new JSONObject();  
            }  
            switch (cmd)
            { 
                case "boot":
                {  
                    JSONObject data = new JSONObject();
                    String[] copy = { "version", "logo", "wordmark", "logoDark", "wordmarkDark", "frame", "akgazi", "flagEn", "flagTr" }; 
                    for (String key : copy) 
                    {
                        data.put(key, bootStatic.opt(key));  
                    } 
                    data.put("config", config);  
                    data.put("plugins", pluginList());  
                    data.put("data", pluginData);
                    data.put("saveRoot", savesDir.getPath()); 
                    reply(id, true, data.toString());  
                    return; 
                } 
                case "setData":
                {  
                    String key = args.optString("key"); 
                    Object value = args.opt("value");
                    if (value == null || value == JSONObject.NULL) 
                    {
                        pluginData.remove(key);  
                    }
                    else
                    { 
                        pluginData.put(key, value); 
                    } 
                    savePluginData();
                    reply(id, true, "null"); 
                    return; 
                }
                case "setConfig":
                { 
                    JSONObject patch = args.optJSONObject("config");  
                    if (patch != null)  
                    {
                        merge(config, patch); 
                        saveConfig(); 
                    } 
                    reply(id, true, config.toString());
                    return;
                } 
                case "plugins":
                    reply(id, true, pluginList().toString());
                    return;  
                case "saveFile":
                {
                    String folder = cleanName(args.optString("folder")); 
                    String name = cleanName(args.optString("name"));
                    if (name.isEmpty())  
                    {  
                        reply(id, false, JSONObject.quote("Empty file name"));
                        return;
                    } 
                    File dir = folder.isEmpty() ? savesDir : new File(savesDir, folder);  
                    File file = new File(dir, name); 
                    boolean ok = writeFile(file, args.optString("content"));  
                    reply(id, ok, JSONObject.quote(file.getPath()));  
                    return; 
                }  
                case "saveCustom":
                {
                    String clean = args.optString("name").replaceAll("[^A-Za-z0-9._-]", "");  
                    if (clean.isEmpty()) 
                    { 
                        clean = "plugin";
                    }  
                    if (!clean.endsWith(".js"))  
                    {  
                        clean += ".js"; 
                    }
                    boolean ok = writeFile(new File(customDir, clean), args.optString("code"));
                    reply(id, ok, ok ? JSONObject.quote("custom-plugins/" + clean) : JSONObject.quote("Could not write plugin"));  
                    return;  
                } 
                case "deleteCustom":
                { 
                    String key = args.optString("key");
                    String name = key.startsWith("custom-plugins/") ? key.substring("custom-plugins/".length()) : "";
                    boolean ok = !name.isEmpty() && !name.contains("/") && !name.contains("\\") && !name.contains("..") && new File(customDir, name).delete(); 
                    if (ok)
                    {
                        pluginData.remove(key); 
                        savePluginData();  
                    }
                    reply(id, ok, "null"); 
                    return;  
                }  
                case "clearCache":
                {
                    final long replyId = id;  
                    ui.post(() ->
                    {  
                        web.clearCache(true); 
                        CookieManager.getInstance().removeAllCookies(null);  
                        WebStorage.getInstance().deleteAllData(); 
                        reply(replyId, true, "null"); 
                    });  
                    return;  
                } 
                case "windowState":
                case "fullscreen":
                    reply(id, true, cmd.equals("fullscreen") ? "true" : "{\"maximized\":true,\"fullscreen\":true}");
                    return;
                case "drag":
                case "resize":
                case "minimize":
                case "maximize":
                    reply(id, true, "null");  
                    return;
                case "backgrounds":
                    reply(id, true, "[]"); 
                    return; 
                case "openUrl":
                {
                    String url = args.optString("url");  
                    boolean ok = url.startsWith("https://"); 
                    if (ok)  
                    {  
                        ui.post(() ->
                        { 
                            try
                            {  
                                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); 
                            } 
                            catch (Exception ignored)  
                            { 
                            } 
                        });  
                    } 
                    reply(id, ok, "null"); 
                    return; 
                }
                case "close":
                    ui.post(this::finish); 
                    return; 
                case "restart":
                    ui.post(() -> web.loadUrl(GAME)); 
                    return;  
                default:
                    reply(id, false, JSONObject.quote("Not available on mobile"));  
            } 
        } 
        catch (Exception error) 
        { 
            reply(id, false, JSONObject.quote(String.valueOf(error.getMessage())));
        }  
    } 

    private void reply(long id, boolean ok, String json)  
    {  
        if (id == 0)
        { 
            return;  
        } 
        String script = "window.__gaziReply && window.__gaziReply(" + id + "," + ok + "," + json + ")";  
        ui.post(() -> web.evaluateJavascript(script, null));  
    } 

    // ---- page loading: put the init script in front of everything else ----

    private class GameClient extends WebViewClient
    {  
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request)  
        {
            Uri url = request.getUrl(); 
            String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT); 
            if (config.optBoolean("adblock", true) && isBlocked(host))  
            {
                return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));  
            }  
            boolean game = host.equals("deeeep.io") || host.equals("www.deeeep.io"); 
            if (game && INIT_PATH.equals(url.getPath()))  
            {  
                Map<String, String> headers = new HashMap<>(); 
                headers.put("Cache-Control", "no-store"); 
                return new WebResourceResponse("application/javascript", "utf-8", 200, "OK", headers, new ByteArrayInputStream(initJs));
            } 
            String path = url.getPath() == null ? "/" : url.getPath(); 
            if (game && request.isForMainFrame() && "GET".equals(request.getMethod()) && !path.matches(".*\\.[A-Za-z0-9]+$"))  
            { 
                try
                {
                    return injectedPage(url.toString(), request.getRequestHeaders());  
                }  
                catch (Exception error)  
                {  
                    return null;
                } 
            }  
            return null; 
        } 

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request)  
        {  
            String host = request.getUrl().getHost() == null ? "" : request.getUrl().getHost();
            if (host.endsWith("deeeep.io"))
            { 
                return false;
            }  
            // links that leave the game open in the browser
            try
            { 
                startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); 
            }  
            catch (Exception ignored) 
            {  
            }  
            return true; 
        }  
    }

    private boolean isBlocked(String host) 
    { 
        for (String blocked : blockedHosts)
        {
            if (host.equals(blocked) || host.endsWith("." + blocked))  
            { 
                return true; 
            }
        }  
        return false;
    } 

    private WebResourceResponse injectedPage(String url, Map<String, String> requestHeaders) throws Exception
    { 
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection(); 
        connection.setInstanceFollowRedirects(true); 
        for (Map.Entry<String, String> header : requestHeaders.entrySet()) 
        { 
            connection.setRequestProperty(header.getKey(), header.getValue());  
        }
        String cookies = CookieManager.getInstance().getCookie(url);  
        if (cookies != null)
        {
            connection.setRequestProperty("Cookie", cookies); 
        } 
        connection.setRequestProperty("Accept-Encoding", "identity");
        int status = connection.getResponseCode(); 
        if (status != 200) 
        {  
            connection.disconnect();
            return null; 
        }  
        List<String> setCookies = connection.getHeaderFields().get("Set-Cookie");
        if (setCookies != null)  
        { 
            for (String cookie : setCookies)  
            { 
                CookieManager.getInstance().setCookie(url, cookie);  
            }  
        } 
        String html = new String(readAll(connection.getInputStream()), StandardCharsets.UTF_8);
        connection.disconnect();  
        String tags = "<script>window.__gaziMobile=true;(function(){var t=" + JSONObject.quote(token)  
            + ",n=window.GaziNative;window.ipc={postMessage:function(m){n.postMessage(t,m)}};})();</script>"
            + "<script src=\"" + INIT_PATH + "\"></script>"; 
        int head = html.toLowerCase(Locale.ROOT).indexOf("<head");
        int at = head == -1 ? -1 : html.indexOf('>', head); 
        html = at == -1 ? tags + html : html.substring(0, at + 1) + tags + html.substring(at + 1);  
        Map<String, String> headers = new HashMap<>();  
        headers.put("Cache-Control", "no-store");  
        return new WebResourceResponse("text/html", "utf-8", 200, "OK", headers, new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8))); 
    }

    // ---- file picker for "Add from file" ----

    private class ChromeClient extends WebChromeClient
    {  
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params)  
        { 
            if (pendingFiles != null) 
            { 
                pendingFiles.onReceiveValue(null); 
            }  
            pendingFiles = callback; 
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);  
            intent.addCategory(Intent.CATEGORY_OPENABLE);  
            intent.setType("*/*");  
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);  
            try
            {
                startActivityForResult(intent, PICK_FILES);
            } 
            catch (Exception error)
            {  
                pendingFiles = null;
                return false; 
            }
            return true; 
        }  
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data)  
    { 
        super.onActivityResult(requestCode, resultCode, data);  
        if (requestCode != PICK_FILES || pendingFiles == null) 
        {
            return;
        }
        Uri[] result = null; 
        if (resultCode == RESULT_OK && data != null)
        {  
            if (data.getClipData() != null) 
            {  
                result = new Uri[data.getClipData().getItemCount()];
                for(int i = 0;i<result.length;i++)  
                { 
                    result[i] = data.getClipData().getItemAt(i).getUri();  
                } 
            }
            else if (data.getData() != null) 
            {
                result = new Uri[] { data.getData() };  
            } 
        }
        pendingFiles.onReceiveValue(result);
        pendingFiles = null; 
    }  

    // ---- helpers ----

    private byte[] readAsset(String name) throws Exception
    { 
        return readAll(getAssets().open(name)); 
    }

    private static byte[] readAll(InputStream in) throws Exception
    { 
        ByteArrayOutputStream out = new ByteArrayOutputStream(); 
        byte[] buffer = new byte[16384]; 
        int read; 
        while ((read = in.read(buffer)) != -1)
        {
            out.write(buffer, 0, read);  
        }
        in.close();  
        return out.toByteArray(); 
    } 

    private static String randomToken()
    { 
        byte[] bytes = new byte[24]; 
        new SecureRandom().nextBytes(bytes);
        StringBuilder text = new StringBuilder();  
        for (byte b : bytes) 
        {  
            text.append(String.format(Locale.ROOT, "%02x", b));
        }
        return text.toString();
    }  
}
