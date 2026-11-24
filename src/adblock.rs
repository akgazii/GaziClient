use webview2_com::Microsoft::Web::WebView2::Win32::*; 
use webview2_com::WebResourceRequestedEventHandler;  
use windows::core::{Interface, HSTRING};  
use wry::{WebView, WebViewExtWindows}; 

pub const BLOCKED_HOSTS: &[&str] = &[
    "doubleclick.net", 
    "googlesyndication.com", 
    "googleadservices.com",
    "googletagservices.com", 
    "googletagmanager.com",  
    "google-analytics.com", 
    "analytics.google.com",  
    "adtrafficquality.google",  
    "fundingchoicesmessages.google.com", 
    "adservice.google.com",  
    "pubmatic.com", 
    "adnxs.com",  
    "rubiconproject.com",  
    "amazon-adsystem.com",
    "criteo.com",
    "criteo.net", 
    "casalemedia.com",  
    "openx.net",
    "taboola.com",  
    "outbrain.com",
    "adinplay.com", 
    "venatus.com", 
    "nitropay.com",  
    "hotjar.com",
    "scorecardresearch.com",  
    "quantserve.com",  
]; 

pub fn install(webview: &WebView) -> windows::core::Result<()>
{  
    let core = webview.webview();  
    let env = webview.environment();
    unsafe
    { 
        let core22 = core.cast::<ICoreWebView2_22>().ok();
        for host in BLOCKED_HOSTS
        {
            let patterns = [format!("*://{}/*", host), format!("*://*.{}/*", host)]; 
            for pattern in patterns
            { 
                let filter = HSTRING::from(pattern);
                if let Some(core22) = &core22
                { 
                    core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                        &filter,  
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL, 
                    )?;
                }  
                else
                {  
                    core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;  
                }  
            } 
        }  
        let mut token: i64 = 0; 
        core.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_, args|
            { 
                if let Some(args) = args
                {  
                    let response = env.CreateWebResourceResponse(None, 403, &HSTRING::from("Blocked"), &HSTRING::from(""))?;
                    args.SetResponse(&response)?;  
                } 
                Ok(())  
            })),
            &mut token,
        )?;
    } 
    Ok(()) 
}  
