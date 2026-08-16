// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn should_force_wayland_backend(is_appimage: bool, is_wayland_session: bool) -> bool {
    is_appimage && is_wayland_session
}

#[cfg(target_os = "linux")]
fn configure_webview_renderer() {
    let is_appimage =
        std::env::var_os("APPIMAGE").is_some() || std::env::var_os("APPDIR").is_some();
    let is_wayland_session = std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE")
            .is_ok_and(|session_type| session_type.eq_ignore_ascii_case("wayland"));

    // linuxdeploy's GTK hook forces AppImages onto X11. Under a Wayland
    // session this can leave the WebKit surface and its input region stuck at
    // the initial window size, especially with NVIDIA/XWayland. Select the
    // native backend before Tauri initializes GTK; real X11 sessions retain
    // linuxdeploy's fallback.
    if should_force_wayland_backend(is_appimage, is_wayland_session) {
        std::env::set_var("GDK_BACKEND", "wayland");
    }

    // NVIDIA's proprietary EGL violates the Wayland explicit-sync protocol,
    // crashing the webview at startup with "Gdk-Message: Error 71 (Protocol
    // error)". Disabling explicit sync avoids the crash while keeping
    // WebKitGTK's DMA-BUF renderer (GPU compositing) enabled; the variable
    // has no effect on non-NVIDIA setups. Machines where DMA-BUF itself
    // cannot allocate buffers can still export
    // WEBKIT_DISABLE_DMABUF_RENDERER=1 as a manual fallback.
    if std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    configure_webview_renderer();

    canopy_lib::run();
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::should_force_wayland_backend;

    #[test]
    fn appimage_uses_native_backend_in_wayland_session() {
        assert!(should_force_wayland_backend(true, true));
    }

    #[test]
    fn non_appimage_launch_does_not_override_gtk_backend() {
        assert!(!should_force_wayland_backend(false, true));
    }

    #[test]
    fn x11_session_keeps_linuxdeploy_fallback() {
        assert!(!should_force_wayland_backend(true, false));
    }
}
