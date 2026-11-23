use crate::store::{read_json, write_json_atomic, Paths, SharedStore};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Serialize, Clone)]
pub struct PluginInfo
{
    pub key: String,
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub tags: Vec<String>,
    pub version: String,
    pub source: String,
    pub code: String,
}

fn header_value(code: &str, tag: &str) -> String
{
    let marker = format!("@{}", tag);
    for line in code.lines().take(40)
    {
        let line = line.trim();
        if !line.starts_with("//")
        {
            continue;
        }
        let rest = line.trim_start_matches('/').trim();
        if let Some(value) = rest.strip_prefix(&marker)
        {
            if value.is_empty() || value.starts_with(' ') || value.starts_with('\t')
            {
                return value.trim().to_string();
            }
        }
    }
    String::new()
}

fn make_info(key: String, fallback_id: &str, version: String, source: &str, code: String) -> PluginInfo
{
    let mut id = header_value(&code, "id");
    if id.is_empty()
    {
        id = fallback_id.to_string();
    }
    let mut name = header_value(&code, "name");
    if name.is_empty()
    {
        name = id.clone();
    }
    let tags = header_value(&code, "tags")
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    PluginInfo
    {
        key,
        id,
        name,
        description: header_value(&code, "description"),
        author: header_value(&code, "author"),
        tags,
        version,
        source: source.to_string(),
        code,
    }
}

fn file_stem(path: &Path) -> String
{
    path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

pub fn load_all(paths: &Paths, store: &SharedStore) -> Vec<PluginInfo>
{
    let mut list: Vec<PluginInfo> = Vec::new();
    let index = read_json(&paths.official.join("index.json")).unwrap_or(json!({}));
    if let Value::Object(entries) = &index
    {
        for (id, meta) in entries
        {
            let version = meta.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if let Ok(code) = fs::read_to_string(paths.official.join(format!("{}.js", id)))
            {
                list.push(make_info(format!("official-plugins/{}.js", id), id, version, "official", code));
            }
        }
    }
    let dev = store.config_str("devPluginsPath");
    if !dev.is_empty()
    {
        let dev_root = PathBuf::from(&dev);
        if let Some(registry) = read_json(&dev_root.join("registry.json"))
        {
            if let Some(Value::Object(meta)) = registry.get("pluginsMetadata")
            {
                for (id, entry) in meta
                {
                    let file = entry.get("file").and_then(|v| v.as_str()).unwrap_or("");
                    let version = entry.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if let Ok(code) = fs::read_to_string(dev_root.join(file))
                    {
                        let key = format!("official-plugins/{}.js", id);
                        list.retain(|p| p.key != key);
                        list.push(make_info(key, id, version, "dev", code));
                    }
                }
            }
        }
    }
    if let Ok(entries) = fs::read_dir(&paths.custom)
    {
        for entry in entries.flatten()
        {
            let path = entry.path();
            if path.extension().map(|e| e == "js").unwrap_or(false)
            {
                if let Ok(code) = fs::read_to_string(&path)
                {
                    let file_name = path.file_name().unwrap().to_string_lossy().to_string();
                    let stem = file_stem(&path);
                    list.push(make_info(format!("custom-plugins/{}", file_name), &stem, String::new(), "custom", code));
                }
            }
        }
    }
    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    list
}

pub fn agent() -> Option<ureq::Agent>
{
    let tls = native_tls::TlsConnector::new().ok()?;
    Some(ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .timeout(Duration::from_secs(20))
        .user_agent("GaziClient")
        .build())
}

fn fetch_text(agent: &ureq::Agent, url: &str) -> Option<String>
{
    agent.get(url).call().ok()?.into_string().ok()
}

pub struct RefreshResult
{
    pub updated: Vec<String>,
    pub failed: Vec<String>,
    pub total: usize,
}

pub fn refresh_registry(paths: &Paths, store: &SharedStore) -> Result<RefreshResult, String>
{
    let agent = agent().ok_or("TLS init failed")?;
    let registries: Vec<String> = store.config().get("registries")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();
    let mut wanted: Vec<(String, String, String)> = Vec::new();
    let mut reached = 0;
    for base in &registries
    {
        let mut base = base.clone();
        if !base.ends_with('/')
        {
            base.push('/');
        }
        let text = match fetch_text(&agent, &format!("{}registry.json", base))
        {
            Some(text) => text,
            None => continue,
        };
        reached += 1;
        let registry: Value = match serde_json::from_str(&text)
        {
            Ok(value) => value,
            Err(_) => continue,
        };
        if let Some(Value::Object(meta)) = registry.get("pluginsMetadata")
        {
            for (id, entry) in meta
            {
                let file = entry.get("file").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let version = entry.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if file.is_empty()
                {
                    continue;
                }
                wanted.retain(|w| &w.0 != id);
                wanted.push((id.clone(), format!("{}{}", base, file), version));
            }
        }
    }
    if reached == 0
    {
        return Err("No registry could be reached".to_string());
    }
    let old_index = read_json(&paths.official.join("index.json")).unwrap_or(json!({}));
    let todo: Vec<(String, String, String)> = wanted.iter()
        .filter(|(id, _, version)|
        {
            let cached = old_index.get(id).and_then(|m| m.get("version")).and_then(|v| v.as_str()).unwrap_or("");
            cached != version || !paths.official.join(format!("{}.js", id)).exists()
        })
        .cloned()
        .collect();
    let updated = Mutex::new(Vec::new());
    let failed = Mutex::new(Vec::new());
    let queue = Mutex::new(todo);
    thread::scope(|scope|
    {
        for _ in 0..8
        {
            scope.spawn(||
            {
                loop
                {
                    let job = queue.lock().unwrap().pop();
                    let (id, url, _) = match job
                    {
                        Some(job) => job,
                        None => break,
                    };
                    match fetch_text(&agent, &url)
                    {
                        Some(code) =>
                        {
                            if fs::write(paths.official.join(format!("{}.js", id)), code).is_ok()
                            {
                                updated.lock().unwrap().push(id);
                            }
                            else
                            {
                                failed.lock().unwrap().push(id);
                            }
                        }
                        None => failed.lock().unwrap().push(id),
                    }
                }
            });
        }
    });
    let failed = failed.into_inner().unwrap();
    let mut index = Map::new();
    for (id, url, version) in &wanted
    {
        if failed.contains(id)
        {
            if let Some(old) = old_index.get(id)
            {
                index.insert(id.clone(), old.clone());
            }
            continue;
        }
        index.insert(id.clone(), json!({ "url": url, "version": version }));
    }
    write_json_atomic(&paths.official.join("index.json"), &Value::Object(index));
    Ok(RefreshResult { updated: updated.into_inner().unwrap(), failed, total: wanted.len() })
}

pub fn save_custom(paths: &Paths, name: &str, code: &str) -> Option<String>
{
    let mut clean: String = name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();
    if clean.is_empty()
    {
        clean = "plugin".to_string();
    }
    if !clean.ends_with(".js")
    {
        clean.push_str(".js");
    }
    fs::write(paths.custom.join(&clean), code).ok()?;
    Some(format!("custom-plugins/{}", clean))
}

pub fn delete_custom(paths: &Paths, key: &str) -> bool
{
    let name = match key.strip_prefix("custom-plugins/")
    {
        Some(name) => name,
        None => return false,
    };
    if name.contains('/') || name.contains('\\') || name.contains("..")
    {
        return false;
    }
    fs::remove_file(paths.custom.join(name)).is_ok()
}

pub fn import_blockyfish(paths: &Paths, store: &SharedStore) -> Result<(usize, usize), String>
{
    let base = std::env::var("APPDATA").map(PathBuf::from).map_err(|_| "APPDATA missing")?.join("blockyfish");
    let index = read_json(&base.join("index")).ok_or("Blockyfish data not found")?;
    let index = index.as_object().ok_or("Bad Blockyfish index")?;
    let mut plugins = 0;
    for (key, uuid) in index
    {
        let uuid = match uuid.as_str()
        {
            Some(uuid) => uuid,
            None => continue,
        };
        if let Some(name) = key.strip_prefix("custom-plugins/")
        {
            let target = paths.custom.join(name);
            if target.exists() || name.contains('/') || name.contains("..")
            {
                continue;
            }
            if fs::copy(base.join("storage").join(uuid), &target).is_ok()
            {
                plugins += 1;
            }
        }
    }
    let mut data_count = 0;
    if let Some(uuid) = index.get("plugin-data.json").and_then(|v| v.as_str())
    {
        if let Some(Value::Object(data)) = read_json(&base.join("storage").join(uuid))
        {
            data_count = store.merge_plugin_data(data, false);
        }
    }
    Ok((plugins, data_count))
}
