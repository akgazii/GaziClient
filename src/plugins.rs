use crate::store::{read_json, Paths, SharedStore}; 
use serde::Serialize;  
use serde_json::Value;
use std::fs;  
use std::path::{Path, PathBuf}; 
use std::sync::Arc; 
use std::time::Duration;

// Blockyfish plugins, frozen inside the exe. Nothing is downloaded at runtime, so a change to the
// Blockyfish registry can never push new code into GaziClient.
const BLOCKYFISH: &[(&str, &str, &str)] = &[
    ("aimline", "1.5", include_str!("../plugins/blockyfish/aimline.js")), 
    ("animatedmeters", "1.0", include_str!("../plugins/blockyfish/animatedmeters.js")), 
    ("assetswapper", "1.2", include_str!("../plugins/blockyfish/assetswapper.js")),  
    ("autofill", "1.3", include_str!("../plugins/blockyfish/autofill.js")),
    ("autoshake", "1.7", include_str!("../plugins/blockyfish/autoshake.js")), 
    ("autosongs", "1.6", include_str!("../plugins/blockyfish/autosongs.js")),
    ("autospin", "1.1", include_str!("../plugins/blockyfish/autospin.js")),
    ("bettervision", "1.2", include_str!("../plugins/blockyfish/bettervision.js")),  
    ("boosthack", "1.6", include_str!("../plugins/blockyfish/boosthack.js")),  
    ("bypasschatfilter", "1.1", include_str!("../plugins/blockyfish/bypasschatfilter.js")), 
    ("custombackground", "1.1", include_str!("../plugins/blockyfish/custombackground.js")),
    ("evowheel", "1.22", include_str!("../plugins/blockyfish/evowheel.js")),  
    ("fiddlergodmodeop", "1.4", include_str!("../plugins/blockyfish/fiddlergodmodeop.js")),
    ("gpotpdot", "1.0", include_str!("../plugins/blockyfish/gpotpdot.js")), 
    ("hideboosttrail", "1.1", include_str!("../plugins/blockyfish/hideboosttrail.js")),
    ("iseedeadfish", "1.1", include_str!("../plugins/blockyfish/iseedeadfish.js")),  
    ("loginautofill", "1.1", include_str!("../plugins/blockyfish/loginautofill.js")),  
    ("nocameraclamp", "1.3", include_str!("../plugins/blockyfish/nocameraclamp.js")),
    ("nograbberanchor", "1.0", include_str!("../plugins/blockyfish/nograbberanchor.js")),
    ("noinvisibleanimals", "1.8", include_str!("../plugins/blockyfish/noinvisibleanimals.js")), 
    ("nozoomlimit", "1.3", include_str!("../plugins/blockyfish/nozoomlimit.js")),
    ("pddoubleanimal", "1.1", include_str!("../plugins/blockyfish/pddoubleanimal.js")),
    ("quickdisconnect", "1.3", include_str!("../plugins/blockyfish/quickdisconnect.js")),
    ("reverseaim", "1.7", include_str!("../plugins/blockyfish/reverseaim.js")),
    ("showroomid", "1.1", include_str!("../plugins/blockyfish/showroomid.js")),  
    ("smallminimap", "1.1", include_str!("../plugins/blockyfish/smallminimap.js")),  
    ("spoofkiller", "1.0", include_str!("../plugins/blockyfish/spoofkiller.js")), 
    ("v3ui", "1.0", include_str!("../plugins/blockyfish/v3ui.js")), 
    ("xray", "1.2", include_str!("../plugins/blockyfish/xray.js")),  
];

// GaziClient's own plugins, shipped inside the exe.
const BUILTIN: &[(&str, &str)] = &[
    ("killcalc.js", include_str!("../plugins/builtin/killcalc.js")),  
    ("aimlineplus.js", include_str!("../plugins/builtin/aimlineplus.js")),  
    ("autododge.js", include_str!("../plugins/builtin/autododge.js")), 
    ("autoplay.js", include_str!("../plugins/builtin/autoplay.js")),
    ("chatradar.js", include_str!("../plugins/builtin/chatradar.js")),
    ("emotepicker.js", include_str!("../plugins/builtin/emotepicker.js")),  
    ("evolvepicker.js", include_str!("../plugins/builtin/evolvepicker.js")),
    ("evolvewatch.js", include_str!("../plugins/builtin/evolvewatch.js")),
    ("predictstrike.js", include_str!("../plugins/builtin/predictstrike.js")),  
    ("thresherkit.js", include_str!("../plugins/builtin/thresherkit.js")),
    ("userids.js", include_str!("../plugins/builtin/userids.js")), 
]; 

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

pub fn load_all(paths: &Paths) -> Vec<PluginInfo>
{  
    let mut list: Vec<PluginInfo> = Vec::new(); 
    for (file, code) in BUILTIN
    {  
        let stem = file.trim_end_matches(".js"); 
        list.push(make_info(format!("gaziclient-plugins/{}", file), stem, String::new(), "builtin", code.to_string()));  
    }  
    for (id, version, code) in BLOCKYFISH
    { 
        list.push(make_info(format!("official-plugins/{}.js", id), id, version.to_string(), "official", code.to_string()));  
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
