#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adblock; 
mod backgrounds;  
mod plugins;  
mod store;

use serde_json::{json, Value}; 
use std::fs; 
use std::path::PathBuf; 
use std::sync::Arc;
use std::thread; 
use store::{Paths, SharedStore};  
use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent}; 
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};  
use tao::platform::windows::WindowBuilderExtWindows;  
use tao::window::{Fullscreen, Icon, ResizeDirection, Window, WindowBuilder}; 
use wry::{WebContext, WebView, WebViewBuilder, WebViewBuilderExtWindows};  

const GAME_URL: &str = "https://deeeep.io";
const LOGO_PNG: &[u8] = include_bytes!("../assets/GaziClientLogo.png");
const WORDMARK_PNG: &[u8] = include_bytes!("../assets/GaziClient-1x.png");
const LOGO_SMALL_PNG: &[u8] = include_bytes!("../assets/GaziClientLogo-1x.png");
const LOGO_DARK_PNG: &[u8] = include_bytes!("../assets/GaziClientLogo-1x-dark.png"); 
const WORDMARK_DARK_PNG: &[u8] = include_bytes!("../assets/GaziClient-1x-dark.png");  
const FRAME_PNG: &[u8] = include_bytes!("../assets/frame.png");
const AKGAZI_JPG: &[u8] = include_bytes!("../assets/akgazi.jpg");  
const FLAG_EN_PNG: &[u8] = include_bytes!("../assets/lang-en.png"); 
const FLAG_TR_PNG: &[u8] = include_bytes!("../assets/lang-tr.png");  
const CONSTANTS_JS: &str = include_str!("../runtime/constants.js");  
const RUNTIME_JS: &str = include_str!("../runtime/runtime.js"); 
const MENU_CSS: &str = include_str!("../runtime/menu.css"); 
const EDITOR_HTML: &str = include_str!("../runtime/editor/editor.html");
const EDITOR_DTS: &str = include_str!("../runtime/editor/blockyfish.d.ts");  
const REACT_JS: &str = include_str!("../runtime/vendor/react.production.min.js");  
const REACT_DOM_JS: &str = include_str!("../runtime/vendor/react-dom.production.min.js");
const JSX_JS: &str = include_str!("../runtime/vendor/sucrase-jsx.min.js");  

enum UserEvent
{ 
    Ipc(String, String),  
    Emit(String, Value),  
    OpenEditor, 
    EditorIpc(String),
}

struct App
{ 
    paths: Arc<Paths>,
    store: Arc<SharedStore>,
    proxy: EventLoopProxy<UserEvent>, 
} 

fn base64(data: &[u8]) -> String
{  
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4); 
    for chunk in data.chunks(3)
    {  
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);  
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });  
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }  
    out
}

fn js_string(text: &str) -> String
{
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string()) 
}  

fn window_icon() -> Option<Icon>
{
    let image = image::load_from_memory(LOGO_PNG).ok()?.to_rgba8();
    let (width, height) = image.dimensions(); 
    Icon::from_rgba(image.into_raw(), width, height).ok() 
}  

fn background_files(dir: &PathBuf) -> Vec<String>
{  
    let mut list: Vec<String> = fs::read_dir(dir) 
        .map(|entries| entries.flatten()  
            .filter_map(|e| e.file_name().into_string().ok()) 
            .filter(|n|
            { 
                let l = n.to_lowercase();
                l.ends_with(".jpg") || l.ends_with(".jpeg") || l.ends_with(".png") || l.ends_with(".webp") || l.ends_with(".gif")  
            }) 
            .collect())  
        .unwrap_or_default();  
    list.sort(); 
    list
}  

fn clean_name(name: &str) -> String
{ 
    name.chars() 
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
        .trim_matches('.')  
        .trim() 
        .to_string() 
}  

fn save_root(store: &SharedStore) -> PathBuf
{ 
    let custom = store.config_str("saveFolder"); 
    if !custom.is_empty() 
    {
        return PathBuf::from(custom); 
    } 
    let home = std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(".")); 
    home.join("Documents").join("GaziClient")  
}  

fn open_in_explorer(path: &PathBuf) 
{ 
    let _ = fs::create_dir_all(path); 
    let _ = std::process::Command::new("explorer").arg(path).spawn(); 
}

fn resize_direction(dir: &str) -> Option<ResizeDirection>
{  
    if dir == "n"
    {
        Some(ResizeDirection::North)
    } 
    else if dir == "s"
    {  
        Some(ResizeDirection::South)  
    } 
    else if dir == "e"
    {  
        Some(ResizeDirection::East) 
    }  
    else if dir == "w"
    {  
        Some(ResizeDirection::West)
    } 
    else if dir == "ne"
    {
        Some(ResizeDirection::NorthEast)
    }  
    else if dir == "nw"
    {  
        Some(ResizeDirection::NorthWest) 
    } 
    else if dir == "se"
    {
        Some(ResizeDirection::SouthEast)  
    }  
    else if dir == "sw"
    {  
        Some(ResizeDirection::SouthWest) 
    }
    else
    {  
        None
    }  
} 

fn window_state(window: &Window) -> Value
{ 
    json!({ "maximized": window.is_maximized(), "fullscreen": window.fullscreen().is_some() }) 
} 

fn remember_window(store: &SharedStore, window: &Window)  
{ 
    if window.fullscreen().is_some() || window.is_minimized()
    {  
        return;  
    }  
    let maximized = window.is_maximized();
    let mut saved = store.config().get("window").cloned().unwrap_or(json!({}));  
    saved["maximized"] = json!(maximized); 
    if !maximized
    {  
        let size = window.inner_size(); 
        if let Ok(position) = window.outer_position()
        { 
            saved["x"] = json!(position.x);  
            saved["y"] = json!(position.y);  
        } 
        saved["width"] = json!(size.width);  
        saved["height"] = json!(size.height);
    } 
    store.set_config(json!({ "window": saved })); 
}

/// Shown the moment WebView2 is up, then hands over to the game. The old page stays on screen
/// until deeeep.io paints, so the gap that used to be an empty window now shows the logo.
fn splash_html() -> String
{  
    format!(concat!(
        "<!doctype html><html><head><meta charset=utf-8>", 
        "<link rel=preconnect href=\"{url}\"><link rel=preconnect href=\"https://api.deeeep.io\">",  
        "<style>html,body{{margin:0;height:100%;background:#070918;overflow:hidden}}",  
        "body{{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:28px}}", 
        "img{{width:132px;height:132px;image-rendering:pixelated}}",
        "i{{display:block;width:120px;height:6px;background:#2A152D;position:relative;overflow:hidden}}",  
        "i::after{{content:'';position:absolute;inset:0;width:40px;background:#8E5F82;animation:m 1s steps(10) infinite}}",
        "@keyframes m{{from{{left:-40px}}to{{left:120px}}}}</style></head>", 
        "<body><img src=\"data:image/png;base64,{logo}\"><i></i>", 
        "<script>requestAnimationFrame(function(){{setTimeout(function(){{location.replace(\"{url}\")}},0)}})</script>",
        "</body></html>"),  
        url = GAME_URL, logo = base64(LOGO_DARK_PNG)) 
}

fn init_script() -> String
{
    let mut script = String::with_capacity(RUNTIME_JS.len() + REACT_JS.len() + REACT_DOM_JS.len() + JSX_JS.len() + 65536); 
    script.push_str("(function(){\nif (window.top != window || location.hostname.indexOf(\"deeeep.io\") == -1)\n{\nreturn;\n}\n");  
    script.push_str("var gaziVendor = { react: "); 
    script.push_str(&js_string(REACT_JS)); 
    script.push_str(", reactDom: ");
    script.push_str(&js_string(REACT_DOM_JS));
    script.push_str(", jsx: "); 
    script.push_str(&js_string(JSX_JS));
    script.push_str(" };\nvar gaziMenuCss = "); 
    script.push_str(&js_string(MENU_CSS));
    script.push_str(";\n");
    script.push_str(CONSTANTS_JS); 
    script.push_str(RUNTIME_JS); 
    script.push_str("\n})();");
    script
}  

impl App
{  
    fn reply(&self, webview: &WebView, id: u64, ok: bool, data: Value) 
    {
        if id == 0
        { 
            return; 
        } 
        let _ = webview.evaluate_script(&format!("window.__gaziReply && window.__gaziReply({},{},{})", id, ok, data));  
    } 

    fn emit(&self, webview: &WebView, name: &str, data: Value)  
    {  
        let _ = webview.evaluate_script(&format!("window.__gaziEvent && window.__gaziEvent({},{})", js_string(name), data)); 
    }  

    fn boot_data(&self) -> Value
    { 
        let list = plugins::load_all(&self.paths);  
        let data = Value::Object(self.store.inner.lock().unwrap().plugin_data.clone());
        json!({
            "version": env!("CARGO_PKG_VERSION"),  
            "config": self.store.config(), 
            "plugins": list,  
            "data": data,  
            "logo": format!("data:image/png;base64,{}", base64(LOGO_SMALL_PNG)), 
            "wordmark": format!("data:image/png;base64,{}", base64(WORDMARK_PNG)),
            "logoDark": format!("data:image/png;base64,{}", base64(LOGO_DARK_PNG)), 
            "wordmarkDark": format!("data:image/png;base64,{}", base64(WORDMARK_DARK_PNG)),  
            "frame": format!("data:image/png;base64,{}", base64(FRAME_PNG)),  
            "akgazi": format!("data:image/jpeg;base64,{}", base64(AKGAZI_JPG)),  
            "flagEn": format!("data:image/png;base64,{}", base64(FLAG_EN_PNG)), 
            "flagTr": format!("data:image/png;base64,{}", base64(FLAG_TR_PNG)),  
            "saveRoot": save_root(&self.store).to_string_lossy(),  
        }) 
    } 

    fn handle_ipc(&self, webview: &WebView, window: &Window, message: &str)
    { 
        let message: Value = match serde_json::from_str(message) 
        {  
            Ok(value) => value, 
            Err(_) => return,
        };  
        let id = message.get("id").and_then(|v| v.as_u64()).unwrap_or(0);  
        let cmd = message.get("cmd").and_then(|v| v.as_str()).unwrap_or("");  
        let args = message.get("args").cloned().unwrap_or(Value::Null);  
        let arg_str = |name: &str| args.get(name).and_then(|v| v.as_str()).unwrap_or("").to_string(); 
        if cmd == "boot"
        {  
            let data = self.boot_data(); 
            self.reply(webview, id, true, data); 
            self.spawn_background_sync();  
        }  
        else if cmd == "setData"
        { 
            self.store.set_plugin_data(arg_str("key"), args.get("value").cloned().unwrap_or(Value::Null));
            self.reply(webview, id, true, Value::Null);
        }
        else if cmd == "setConfig"
        {
            let config = args.get("config").cloned().unwrap_or(json!({}));  
            if let Some(zoom) = config.get("zoom").and_then(|v| v.as_f64()) 
            {
                let _ = webview.zoom(zoom); 
            }
            self.store.set_config(config);  
            self.reply(webview, id, true, self.store.config()); 
        }  
        else if cmd == "plugins"
        {  
            let list = plugins::load_all(&self.paths);
            self.reply(webview, id, true, json!(list)); 
        }  
        else if cmd == "saveFile"
        {
            let folder = clean_name(&arg_str("folder")); 
            let name = clean_name(&arg_str("name"));
            if name.is_empty() 
            {  
                self.reply(webview, id, false, json!("Empty file name")); 
                return; 
            }  
            let mut dir = save_root(&self.store);
            if !folder.is_empty() 
            { 
                dir = dir.join(folder); 
            } 
            let path = dir.join(name); 
            let ok = fs::create_dir_all(&dir).is_ok() && fs::write(&path, arg_str("content")).is_ok();
            self.reply(webview, id, ok, json!(path.to_string_lossy())); 
        }
        else if cmd == "openFolder"
        {
            let which = arg_str("which");  
            let path = if which == "custom"
            {  
                self.paths.custom.clone() 
            } 
            else if which == "backgrounds"
            { 
                self.paths.backgrounds.clone() 
            }  
            else if which == "saves"
            { 
                save_root(&self.store)  
            }  
            else
            { 
                self.paths.root.clone()  
            }; 
            open_in_explorer(&path);  
            self.reply(webview, id, true, Value::Null);  
        } 
        else if cmd == "saveCustom"
        {  
            match plugins::save_custom(&self.paths, &arg_str("name"), &arg_str("code"))  
            { 
                Some(key) => self.reply(webview, id, true, json!(key)), 
                None => self.reply(webview, id, false, json!("Could not write plugin")),  
            }
        }  
        else if cmd == "deleteCustom"
        {  
            let key = arg_str("key"); 
            let ok = plugins::delete_custom(&self.paths, &key);  
            if ok
            {  
                self.store.set_plugin_data(key, Value::Null); 
            }
            self.reply(webview, id, ok, Value::Null); 
        } 
        else if cmd == "importBlockyfish"
        {
            match plugins::import_blockyfish(&self.paths, &self.store) 
            {  
                Ok((plugins, data)) => self.reply(webview, id, true, json!({ "plugins": plugins, "data": data })),
                Err(error) => self.reply(webview, id, false, json!(error)),
            } 
        }
        else if cmd == "devtools"
        {  
            webview.open_devtools();  
            self.reply(webview, id, true, Value::Null);  
        }  
        else if cmd == "clearCache"
        { 
            let ok = webview.clear_all_browsing_data().is_ok();  
            self.reply(webview, id, ok, Value::Null);
        } 
        else if cmd == "fullscreen"
        { 
            if window.fullscreen().is_some()  
            {  
                window.set_fullscreen(None); 
            }  
            else
            { 
                window.set_fullscreen(Some(Fullscreen::Borderless(None)));
            } 
            self.reply(webview, id, true, json!(window.fullscreen().is_some()));  
        }
        else if cmd == "drag"
        { 
            let _ = window.drag_window();
            self.reply(webview, id, true, Value::Null);
        }  
        else if cmd == "resize"
        {  
            let direction = resize_direction(&arg_str("dir")); 
            if let Some(direction) = direction
            {
                if !window.is_maximized() && window.fullscreen().is_none()  
                { 
                    let _ = window.drag_resize_window(direction); 
                }
            }
            self.reply(webview, id, true, Value::Null);  
        } 
        else if cmd == "minimize"
        { 
            window.set_minimized(true);  
            self.reply(webview, id, true, Value::Null); 
        } 
        else if cmd == "maximize"
        { 
            window.set_maximized(!window.is_maximized()); 
            self.reply(webview, id, true, json!(window.is_maximized())); 
        } 
        else if cmd == "close"
        {  
            self.store.flush();
            std::process::exit(0);  
        } 
        else if cmd == "windowState"
        { 
            self.reply(webview, id, true, window_state(window)); 
        } 
        else if cmd == "backgrounds"
        {  
            self.reply(webview, id, true, json!(background_files(&self.paths.backgrounds)));
        }
        else if cmd == "background"
        { 
            let files = background_files(&self.paths.backgrounds);  
            let wanted = arg_str("name");  
            let name = if files.contains(&wanted)
            { 
                Some(wanted)  
            } 
            else if files.is_empty()
            {
                None
            }  
            else
            {  
                let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0); 
                Some(files[(seed % files.len() as u128) as usize].clone())
            };  
            match name.and_then(|name| fs::read(self.paths.backgrounds.join(&name)).ok().map(|data| (name, data)))
            {  
                Some((name, data)) =>
                {
                    let lower = name.to_lowercase(); 
                    let mime = if lower.ends_with(".png") 
                    {
                        "image/png"
                    }  
                    else if lower.ends_with(".webp")  
                    {  
                        "image/webp"
                    } 
                    else if lower.ends_with(".gif")  
                    {  
                        "image/gif"
                    } 
                    else
                    { 
                        "image/jpeg"
                    }; 
                    self.reply(webview, id, true, json!({ "name": name, "url": format!("data:{};base64,{}", mime, base64(&data)) })); 
                }
                None => self.reply(webview, id, false, json!("No backgrounds")),  
            } 
        }  
        else if cmd == "openUrl"
        {  
            let url = arg_str("url");  
            let ok = url.starts_with("https://") && !url.contains('"') && !url.contains(' ');
            if ok
            {  
                let _ = std::process::Command::new("explorer").arg(&url).spawn(); 
            }  
            self.reply(webview, id, ok, Value::Null); 
        } 
        else if cmd == "openEditor"
        {
            let _ = self.proxy.send_event(UserEvent::OpenEditor);  
            self.reply(webview, id, true, Value::Null);  
        } 
        else if cmd == "restart"
        {  
            self.store.flush(); 
            if let Ok(exe) = std::env::current_exe()
            {
                let _ = std::process::Command::new(exe).spawn(); 
            }  
            std::process::exit(0);
        } 
        else
        {
            self.reply(webview, id, false, json!(format!("Unknown command {}", cmd)));  
        }  
    } 

    fn handle_editor_ipc(&self, editor: &WebView, editor_window: &Window, main: &WebView, message: &str) -> bool
    {  
        let message: Value = match serde_json::from_str(message) 
        {
            Ok(value) => value,
            Err(_) => return false, 
        };  
        let id = message.get("id").and_then(|v| v.as_u64()).unwrap_or(0); 
        let cmd = message.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
        let args = message.get("args").cloned().unwrap_or(Value::Null); 
        let arg_str = |name: &str| args.get(name).and_then(|v| v.as_str()).unwrap_or("").to_string();  
        if cmd == "init"
        { 
            self.reply(editor, id, true, json!({ 
                "logo": format!("data:image/png;base64,{}", base64(LOGO_DARK_PNG)), 
                "typings": EDITOR_DTS, 
            })); 
        } 
        else if cmd == "list"
        {  
            let list: Vec<Value> = plugins::load_all(&self.paths).into_iter()
                .map(|p| json!({ "key": p.key, "id": p.id, "name": p.name, "source": p.source, "code": p.code }))  
                .collect(); 
            self.reply(editor, id, true, json!(list)); 
        } 
        else if cmd == "save"
        { 
            match plugins::save_custom(&self.paths, &arg_str("name"), &arg_str("code"))
            {  
                Some(key) =>
                {
                    self.reply(editor, id, true, json!(key)); 
                    self.emit(main, "pluginsChanged", json!({ "key": key }));  
                    if args.get("reload").and_then(|v| v.as_bool()).unwrap_or(false)  
                    {
                        self.store.flush(); 
                        let _ = main.evaluate_script("location.reload()");  
                    } 
                }
                None => self.reply(editor, id, false, json!("Could not write plugin")),
            }  
        }
        else if cmd == "openFolder"
        {  
            open_in_explorer(&self.paths.custom); 
            self.reply(editor, id, true, Value::Null);
        }  
        else if cmd == "drag"
        {  
            let _ = editor_window.drag_window(); 
            self.reply(editor, id, true, Value::Null);
        } 
        else if cmd == "resize"
        {  
            if let Some(direction) = resize_direction(&arg_str("dir"))  
            {
                if !editor_window.is_maximized()  
                { 
                    let _ = editor_window.drag_resize_window(direction);  
                }  
            } 
            self.reply(editor, id, true, Value::Null); 
        } 
        else if cmd == "minimize"
        { 
            editor_window.set_minimized(true);  
            self.reply(editor, id, true, Value::Null); 
        }  
        else if cmd == "maximize"
        {  
            editor_window.set_maximized(!editor_window.is_maximized());  
            self.reply(editor, id, true, Value::Null);  
        } 
        else if cmd == "close"
        {  
            return true;
        }
        else
        { 
            self.reply(editor, id, false, json!(format!("Unknown command {}", cmd))); 
        }  
        false
    }  

    fn spawn_background_sync(&self) 
    {  
        let dir = self.paths.backgrounds.clone(); 
        let urls: Vec<String> = match self.store.config().get("backgroundUrls").and_then(|v| v.as_array().cloned()) 
        {  
            Some(list) => list.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect(), 
            None => backgrounds::DEFAULT_URLS.iter().map(|s| s.to_string()).collect(),
        };  
        let proxy = self.proxy.clone();
        thread::spawn(move ||
        {  
            let added = backgrounds::sync(&dir, &urls); 
            if added > 0
            {  
                let _ = proxy.send_event(UserEvent::Emit("backgroundsUpdated".to_string(), json!({ "added": added }))); 
            } 
        });  
    } 
} 

/// Writes everything the Android app needs into one folder: the same init script, the plugin list and
/// the images. Used by android/build.ps1 so desktop and mobile always ship the same runtime and plugins.
fn export_mobile(dir: &PathBuf) -> std::io::Result<()>
{  
    fs::create_dir_all(dir)?; 
    fs::write(dir.join("init.js"), init_script())?; 
    let empty = std::env::temp_dir().join("gaziclient-export-empty"); 
    let _ = fs::create_dir_all(&empty);
    let paths = Paths
    { 
        root: empty.clone(), 
        official: empty.clone(), 
        custom: empty.clone(),  
        backgrounds: empty.clone(),  
        webview: empty.clone(),
        config: empty.join("config.json"), 
        plugin_data: empty.join("plugin-data.json"), 
    }; 
    let image = |mime: &str, data: &[u8]| format!("data:{};base64,{}", mime, base64(data)); 
    let boot = json!({
        "version": env!("CARGO_PKG_VERSION"),  
        "defaults": store::default_config(),
        "plugins": plugins::load_all(&paths),
        "logo": image("image/png", LOGO_SMALL_PNG), 
        "wordmark": image("image/png", WORDMARK_PNG),  
        "logoDark": image("image/png", LOGO_DARK_PNG),  
        "wordmarkDark": image("image/png", WORDMARK_DARK_PNG), 
        "frame": image("image/png", FRAME_PNG),  
        "akgazi": image("image/jpeg", AKGAZI_JPG),
        "flagEn": image("image/png", FLAG_EN_PNG),
        "flagTr": image("image/png", FLAG_TR_PNG), 
        "blockedHosts": adblock::BLOCKED_HOSTS,  
    });  
    fs::write(dir.join("boot.json"), serde_json::to_string(&boot).unwrap_or_default())?;
    fs::write(dir.join("logo.png"), LOGO_PNG)?;
    Ok(()) 
}  

fn main()
{
    let args: Vec<String> = std::env::args().collect();  
    if args.len() >= 3 && args[1] == "--export-mobile"
    { 
        let ok = export_mobile(&PathBuf::from(&args[2])).is_ok(); 
        std::process::exit(if ok { 0 } else { 1 });
    }
    let paths = Arc::new(Paths::new());  
    let store = SharedStore::load(&paths);
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();  
    let proxy = event_loop.create_proxy();
    let app = App { paths: paths.clone(), store: store.clone(), proxy: proxy.clone() };  

    let saved_window = store.config().get("window").cloned().unwrap_or(Value::Null);
    let mut builder = WindowBuilder::new() 
        .with_title("GaziClient")  
        .with_window_icon(window_icon())  
        .with_decorations(false) 
        .with_undecorated_shadow(true)
        .with_background_color((7, 9, 24, 255)) 
        .with_visible(false) 
        .with_inner_size(LogicalSize::new(1280.0, 780.0))
        .with_min_inner_size(LogicalSize::new(640.0, 400.0)); 
    if let (Some(width), Some(height)) = (saved_window.get("width").and_then(|v| v.as_u64()), saved_window.get("height").and_then(|v| v.as_u64()))
    {  
        builder = builder.with_inner_size(PhysicalSize::new(width as u32, height as u32)); 
    }
    if let (Some(x), Some(y)) = (saved_window.get("x").and_then(|v| v.as_i64()), saved_window.get("y").and_then(|v| v.as_i64()))
    {  
        builder = builder.with_position(PhysicalPosition::new(x as i32, y as i32));  
    }  
    let window = builder.build(&event_loop).expect("window");  
    if saved_window.get("maximized").and_then(|v| v.as_bool()).unwrap_or(false) 
    {
        window.set_maximized(true);  
    } 
    window.set_visible(true); 

    let mut browser_args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,AsyncDns,DnsOverHttps --autoplay-policy=no-user-gesture-required");  
    if store.config_bool("unlockFps")
    {  
        browser_args.push_str(" --disable-frame-rate-limit --disable-gpu-vsync"); 
    }  
    if let Ok(port) = std::env::var("GAZI_DEBUG_PORT") 
    { 
        browser_args.push_str(&format!(" --remote-debugging-port={}", port));
    }  

    let mut context = WebContext::new(Some(paths.webview.clone()));
    let ipc_proxy = proxy.clone(); 
    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_html(splash_html())  
        .with_background_color((7, 9, 24, 255))
        .with_initialization_script(init_script())  
        .with_devtools(true)
        .with_additional_browser_args(browser_args.clone()) 
        .with_ipc_handler(move |request|
        {  
            let url = request.uri().to_string(); 
            let _ = ipc_proxy.send_event(UserEvent::Ipc(url, request.into_body()));
        })
        .build(&window) 
        .expect("webview");  

    if store.config().get("adblock").and_then(|v| v.as_bool()).unwrap_or(true) 
    { 
        if let Err(error) = adblock::install(&webview)
        {  
            eprintln!("adblock failed: {:?}", error); 
        } 
    }

    let zoom = store.config().get("zoom").and_then(|v| v.as_f64()).unwrap_or(1.0);
    if (zoom - 1.0).abs() > 0.001
    {
        let _ = webview.zoom(zoom); 
    } 

    let mut editor: Option<(Window, WebView)> = None; 
    event_loop.run(move |event, target, control_flow|
    { 
        *control_flow = ControlFlow::Wait;  
        if let Event::WindowEvent { window_id, event: ref window_event, .. } = event
        {  
            let is_editor = editor.as_ref().map(|(w, _)| w.id() == window_id).unwrap_or(false); 
            if is_editor
            {
                if let WindowEvent::CloseRequested = window_event
                { 
                    editor = None;
                } 
                return; 
            }  
        } 
        match event
        {  
            Event::UserEvent(UserEvent::OpenEditor) =>
            {  
                if let Some((editor_window, _)) = &editor
                { 
                    editor_window.set_minimized(false);  
                    editor_window.set_focus(); 
                    return;  
                }  
                let editor_window = match WindowBuilder::new() 
                    .with_title("GaziClient Editor")
                    .with_window_icon(window_icon())  
                    .with_decorations(false)
                    .with_undecorated_shadow(true)  
                    .with_inner_size(LogicalSize::new(1240.0, 780.0)) 
                    .with_min_inner_size(LogicalSize::new(640.0, 400.0)) 
                    .build(target)  
                {  
                    Ok(w) => w,
                    Err(_) => return,  
                }; 
                let editor_proxy = proxy.clone();  
                let built = WebViewBuilder::new_with_web_context(&mut context)  
                    .with_html(EDITOR_HTML)
                    .with_background_color((14, 10, 18, 255)) 
                    .with_devtools(true) 
                    .with_additional_browser_args(browser_args.clone())
                    .with_ipc_handler(move |request|
                    {
                        let _ = editor_proxy.send_event(UserEvent::EditorIpc(request.into_body()));
                    }) 
                    .build(&editor_window); 
                if let Ok(editor_webview) = built
                {  
                    editor = Some((editor_window, editor_webview)); 
                }  
            }
            Event::UserEvent(UserEvent::EditorIpc(body)) =>
            {  
                let mut close = false;
                if let Some((editor_window, editor_webview)) = &editor
                {
                    close = app.handle_editor_ipc(editor_webview, editor_window, &webview, &body);  
                }  
                if close
                { 
                    editor = None;  
                } 
            } 
            Event::UserEvent(UserEvent::Ipc(url, body)) =>
            {  
                let host_ok = url.parse::<wry::http::Uri>().ok()  
                    .and_then(|uri| uri.host().map(|h| h == "deeeep.io" || h.ends_with(".deeeep.io"))) 
                    .unwrap_or(false);  
                if host_ok
                { 
                    app.handle_ipc(&webview, &window, &body); 
                }  
            } 
            Event::UserEvent(UserEvent::Emit(name, data)) => app.emit(&webview, &name, data),  
            Event::WindowEvent { event: WindowEvent::Resized(_), .. } =>
            {  
                remember_window(&store, &window); 
                app.emit(&webview, "windowState", window_state(&window));  
            } 
            Event::WindowEvent { event: WindowEvent::Moved(_), .. } =>
            { 
                remember_window(&store, &window);
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } =>
            {  
                store.flush();
                *control_flow = ControlFlow::Exit;
            }
            _ => {} 
        } 
    });  
}
