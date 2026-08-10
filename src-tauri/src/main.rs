// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn configure_webview_renderer() {
    // WebKitGTK's DMA-BUF renderer can fail to allocate a GBM buffer on some
    // Linux GPU/driver combinations, leaving the AppImage window blank. This
    // must be configured before Tauri initializes GTK and its webview runtime.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    configure_webview_renderer();

    canopy_lib::run();
}
