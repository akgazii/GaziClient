use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub struct Paths
{
    pub root: PathBuf,
    pub official: PathBuf,
    pub custom: PathBuf,
    pub backgrounds: PathBuf,
    pub webview: PathBuf,
    pub config: PathBuf,
    pub plugin_data: PathBuf,
}

impl Paths
{
    pub fn new() -> Paths
    {
        let base = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."));
        let root = base.join("GaziClient");
        let paths = Paths
        {
            official: root.join("plugins").join("official"),
            custom: root.join("plugins").join("custom"),
            backgrounds: root.join("backgrounds"),
            webview: root.join("webview"),
            config: root.join("config.json"),
            plugin_data: root.join("plugin-data.json"),
            root,
        };
        let _ = fs::create_dir_all(&paths.official);
        let _ = fs::create_dir_all(&paths.custom);
        let _ = fs::create_dir_all(&paths.backgrounds);
        let _ = fs::create_dir_all(&paths.webview);
        paths
    }
}

pub fn default_config() -> Value
{
    json!({
        "registries": ["https://raw.githubusercontent.com/blockyfish-client/api/main/"],
        "devPluginsPath": "",
        "saveFolder": "",
        "menuKey": "F1",
        "unlockFps": false,
        "discordRpc": true,
        "autoUpdatePlugins": true,
        "adblock": true,
        "replaceLogo": true,
        "background": "random",
        "backgroundInterval": 10,
        "zoom": 1.0
    })
}

pub fn read_json(path: &Path) -> Option<Value>
{
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_json_atomic(path: &Path, value: &Value) -> bool
{
    let tmp = path.with_extension("tmp");
    let text = match serde_json::to_string(value)
    {
        Ok(text) => text,
        Err(_) => return false,
    };
    if fs::write(&tmp, text).is_err()
    {
        return false;
    }
    fs::rename(&tmp, path).is_ok()
}

pub struct Store
{
    pub config: Value,
    pub plugin_data: Map<String, Value>,
}

pub struct SharedStore
{
    pub inner: Mutex<Store>,
    dirty_config: AtomicBool,
    dirty_data: AtomicBool,
    config_path: PathBuf,
    data_path: PathBuf,
}

impl SharedStore
{
    pub fn load(paths: &Paths) -> Arc<SharedStore>
    {
        let mut config = default_config();
        if let Some(Value::Object(saved)) = read_json(&paths.config)
        {
            if let Value::Object(target) = &mut config
            {
                for (key, value) in saved
                {
                    target.insert(key, value);
                }
            }
        }
        let plugin_data = match read_json(&paths.plugin_data)
        {
            Some(Value::Object(map)) => map,
            _ => Map::new(),
        };
        let store = Arc::new(SharedStore
        {
            inner: Mutex::new(Store { config, plugin_data }),
            dirty_config: AtomicBool::new(false),
            dirty_data: AtomicBool::new(false),
            config_path: paths.config.clone(),
            data_path: paths.plugin_data.clone(),
        });
        let saver = store.clone();
        thread::spawn(move ||
        {
            loop
            {
                thread::sleep(Duration::from_millis(1500));
                saver.flush();
            }
        });
        store
    }

    pub fn config(&self) -> Value
    {
        self.inner.lock().unwrap().config.clone()
    }

    pub fn config_str(&self, key: &str) -> String
    {
        let store = self.inner.lock().unwrap();
        store.config.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
    }

    pub fn config_bool(&self, key: &str) -> bool
    {
        let store = self.inner.lock().unwrap();
        store.config.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
    }

    pub fn set_config(&self, value: Value)
    {
        let mut store = self.inner.lock().unwrap();
        if let (Value::Object(target), Value::Object(source)) = (&mut store.config, value)
        {
            for (key, value) in source
            {
                target.insert(key, value);
            }
        }
        self.dirty_config.store(true, Ordering::Relaxed);
    }

    pub fn set_plugin_data(&self, key: String, value: Value)
    {
        let mut store = self.inner.lock().unwrap();
        if value.is_null()
        {
            store.plugin_data.remove(&key);
        }
        else
        {
            store.plugin_data.insert(key, value);
        }
        self.dirty_data.store(true, Ordering::Relaxed);
    }

    pub fn merge_plugin_data(&self, entries: Map<String, Value>, overwrite: bool) -> usize
    {
        let mut store = self.inner.lock().unwrap();
        let mut count = 0;
        for (key, value) in entries
        {
            if overwrite || !store.plugin_data.contains_key(&key)
            {
                store.plugin_data.insert(key, value);
                count += 1;
            }
        }
        self.dirty_data.store(true, Ordering::Relaxed);
        count
    }

    pub fn flush(&self)
    {
        if self.dirty_config.swap(false, Ordering::Relaxed)
        {
            let config = self.inner.lock().unwrap().config.clone();
            write_json_atomic(&self.config_path, &config);
        }
        if self.dirty_data.swap(false, Ordering::Relaxed)
        {
            let data = Value::Object(self.inner.lock().unwrap().plugin_data.clone());
            write_json_atomic(&self.data_path, &data);
        }
    }
}
