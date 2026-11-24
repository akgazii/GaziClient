use image::codecs::jpeg::JpegEncoder; 
use image::imageops::FilterType;
use std::fs;  
use std::io::Read;
use std::path::Path;  

pub const DEFAULT_URLS: &[&str] = &[
    "https://w.wallhaven.cc/full/83/wallhaven-83wdwk.jpg", 
    "https://w.wallhaven.cc/full/nk/wallhaven-nk67ym.jpg", 
    "https://w.wallhaven.cc/full/lq/wallhaven-lqvz2p.png", 
    "https://w.wallhaven.cc/full/96/wallhaven-96y76w.jpg", 
    "https://w.wallhaven.cc/full/0j/wallhaven-0j52jm.jpg",
    "https://w.wallhaven.cc/full/42/wallhaven-42339g.jpg",  
    "https://w.wallhaven.cc/full/45/wallhaven-455dy5.jpg", 
    "https://w.wallhaven.cc/full/ne/wallhaven-nerwro.jpg",  
    "https://w.wallhaven.cc/full/4o/wallhaven-4o7oom.jpg",  
    "https://w.wallhaven.cc/full/0p/wallhaven-0pjd1m.jpg", 
    "https://w.wallhaven.cc/full/gp/wallhaven-gprwod.png",
    "https://w.wallhaven.cc/full/01/wallhaven-01mk33.jpg",  
    "https://w.wallhaven.cc/full/yx/wallhaven-yx1yq7.jpg", 
    "https://w.wallhaven.cc/full/4g/wallhaven-4g1ope.jpg",
    "https://w.wallhaven.cc/full/kw/wallhaven-kw756d.jpg",  
    "https://w.wallhaven.cc/full/4l/wallhaven-4lee7r.jpg",  
    "https://w.wallhaven.cc/full/j5/wallhaven-j518jm.jpg", 
    "https://w.wallhaven.cc/full/01/wallhaven-0127gg.jpg",  
    "https://w.wallhaven.cc/full/95/wallhaven-9558k1.jpg",  
    "https://w.wallhaven.cc/full/dg/wallhaven-dg67mm.jpg",
];

pub fn file_name_for(url: &str) -> Option<String>
{ 
    let base = url.split('?').next()?.rsplit('/').next()?; 
    let stem = base.rsplit_once('.').map(|(s, _)| s).unwrap_or(base);  
    let clean: String = stem.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();  
    if clean.is_empty()  
    { 
        return None;  
    }  
    Some(format!("{}.jpg", clean)) 
} 

fn download(agent: &ureq::Agent, url: &str, target: &Path) -> bool
{
    let response = match agent.get(url).call()
    { 
        Ok(response) => response, 
        Err(_) => return false,
    };  
    let mut data = Vec::new(); 
    if response.into_reader().take(40 * 1024 * 1024).read_to_end(&mut data).is_err()  
    {
        return false;  
    }  
    let image = match image::load_from_memory(&data)  
    { 
        Ok(image) => image,  
        Err(_) => return false, 
    }; 
    let image = if image.width() > 1920
    {
        let height = (image.height() as f64 * 1920.0 / image.width() as f64).round() as u32;  
        image.resize_exact(1920, height, FilterType::Lanczos3)  
    }
    else
    {
        image
    }; 
    let rgb = image.to_rgb8();  
    let tmp = target.with_extension("part"); 
    let file = match fs::File::create(&tmp)
    { 
        Ok(file) => file,  
        Err(_) => return false, 
    };  
    let mut writer = std::io::BufWriter::new(file);  
    if JpegEncoder::new_with_quality(&mut writer, 85).encode_image(&rgb).is_err() 
    {  
        let _ = fs::remove_file(&tmp); 
        return false;
    } 
    drop(writer);
    fs::rename(&tmp, target).is_ok()  
} 

pub fn sync(dir: &Path, urls: &[String]) -> usize
{ 
    let missing: Vec<(String, String)> = urls.iter()  
        .filter_map(|url| file_name_for(url).map(|name| (url.clone(), name))) 
        .filter(|(_, name)| !dir.join(name).exists()) 
        .collect();
    if missing.is_empty()
    { 
        return 0; 
    }
    let agent = match crate::plugins::agent() 
    { 
        Some(agent) => agent,  
        None => return 0,  
    }; 
    let mut count = 0;
    for (url, name) in missing
    { 
        if download(&agent, &url, &dir.join(&name)) 
        { 
            count += 1;
        }
    }
    count
}  
