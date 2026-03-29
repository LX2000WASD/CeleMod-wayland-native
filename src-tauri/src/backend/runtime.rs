use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::backend::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettings {
    #[serde(default = "default_require_wayland_session")]
    pub require_wayland_session: bool,
    #[serde(default = "default_disable_dmabuf_renderer")]
    pub disable_dmabuf_renderer: bool,
    #[serde(default)]
    pub disable_compositing_mode: bool,
    #[serde(default = "default_log_runtime_diagnostics")]
    pub log_runtime_diagnostics: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnostics {
    pub config_path: String,
    pub config_exists: bool,
    pub settings_source: String,
    pub is_wayland_session: bool,
    pub require_wayland_session: bool,
    pub xdg_session_type: Option<String>,
    pub wayland_display: Option<String>,
    pub display: Option<String>,
    pub xdg_runtime_dir: Option<String>,
    pub gdk_backend: Option<String>,
    pub webkit_disable_dmabuf_renderer: Option<String>,
    pub webkit_disable_compositing_mode: Option<String>,
    pub effective_disable_dmabuf_renderer: bool,
    pub effective_disable_compositing_mode: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSaveResult {
    pub settings: RuntimeSettings,
    pub config_path: String,
    pub restart_required: bool,
}

fn default_require_wayland_session() -> bool {
    true
}

fn default_disable_dmabuf_renderer() -> bool {
    true
}

fn default_log_runtime_diagnostics() -> bool {
    true
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            require_wayland_session: default_require_wayland_session(),
            disable_dmabuf_renderer: default_disable_dmabuf_renderer(),
            disable_compositing_mode: false,
            log_runtime_diagnostics: default_log_runtime_diagnostics(),
        }
    }
}

fn runtime_config_path() -> PathBuf {
    paths::app_config_dir_path().join("runtime.json")
}

fn read_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn env_flag_enabled(name: &str) -> bool {
    read_env(name)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn set_flag_env(name: &str, enabled: bool) {
    unsafe {
        if enabled {
            std::env::set_var(name, "1");
        } else {
            std::env::remove_var(name);
        }
    }
}

fn load_runtime_settings_inner() -> (RuntimeSettings, bool) {
    let config_path = runtime_config_path();
    if !config_path.exists() {
        return (RuntimeSettings::default(), false);
    }

    let settings = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|content| serde_json::from_str::<RuntimeSettings>(&content).ok())
        .unwrap_or_default();

    (settings, true)
}

fn build_diagnostics(
    settings: RuntimeSettings,
    config_exists: bool,
    settings_source: &str,
) -> RuntimeDiagnostics {
    let xdg_session_type = read_env("XDG_SESSION_TYPE");
    let wayland_display = read_env("WAYLAND_DISPLAY");
    let display = read_env("DISPLAY");
    let xdg_runtime_dir = read_env("XDG_RUNTIME_DIR");
    let gdk_backend = read_env("GDK_BACKEND");
    let webkit_disable_dmabuf_renderer = read_env("WEBKIT_DISABLE_DMABUF_RENDERER");
    let webkit_disable_compositing_mode = read_env("WEBKIT_DISABLE_COMPOSITING_MODE");
    let is_wayland_session = xdg_session_type
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || wayland_display.is_some();

    let mut warnings = Vec::new();
    if settings.require_wayland_session && !is_wayland_session {
        warnings.push(
            "当前会话不是 Wayland。本 fork 仅面向 Wayland 场景设计，行为可能不符合预期。"
                .to_string(),
        );
    }
    if is_wayland_session && !env_flag_enabled("WEBKIT_DISABLE_DMABUF_RENDERER") {
        warnings.push(
            "Wayland 会话中未禁用 DMA-BUF renderer，可能触发 WebKitGTK 协议错误。".to_string(),
        );
    }
    if xdg_runtime_dir.is_none() {
        warnings.push("XDG_RUNTIME_DIR 未设置，Wayland 会话可能无法正常工作。".to_string());
    }
    if settings.disable_dmabuf_renderer != env_flag_enabled("WEBKIT_DISABLE_DMABUF_RENDERER") {
        warnings.push(
            "配置文件中的 DMA-BUF 开关与当前进程环境不一致；保存后的修改需要重启应用才能完全生效。"
                .to_string(),
        );
    }
    if settings.disable_compositing_mode != env_flag_enabled("WEBKIT_DISABLE_COMPOSITING_MODE") {
        warnings.push(
            "配置文件中的 compositing 开关与当前进程环境不一致；保存后的修改需要重启应用才能完全生效。".to_string(),
        );
    }

    RuntimeDiagnostics {
        config_path: runtime_config_path().to_string_lossy().to_string(),
        config_exists,
        settings_source: settings_source.to_string(),
        is_wayland_session,
        require_wayland_session: settings.require_wayland_session,
        xdg_session_type,
        wayland_display,
        display,
        xdg_runtime_dir,
        gdk_backend,
        webkit_disable_dmabuf_renderer,
        webkit_disable_compositing_mode,
        effective_disable_dmabuf_renderer: env_flag_enabled("WEBKIT_DISABLE_DMABUF_RENDERER"),
        effective_disable_compositing_mode: env_flag_enabled("WEBKIT_DISABLE_COMPOSITING_MODE"),
        warnings,
    }
}

pub fn initialize_runtime() {
    let (settings, config_exists) = load_runtime_settings_inner();
    let xdg_session_type = read_env("XDG_SESSION_TYPE");
    let is_wayland_session = xdg_session_type
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some();

    if is_wayland_session {
        set_flag_env(
            "WEBKIT_DISABLE_DMABUF_RENDERER",
            settings.disable_dmabuf_renderer,
        );
        set_flag_env(
            "WEBKIT_DISABLE_COMPOSITING_MODE",
            settings.disable_compositing_mode,
        );
    }

    let settings_source = if config_exists { "config" } else { "defaults" };
    let diagnostics = build_diagnostics(settings.clone(), config_exists, settings_source);
    if settings.log_runtime_diagnostics {
        eprintln!(
            "Wayland runtime diagnostics: session={:?}, dmabuf_disabled={}, compositing_disabled={}, gdk_backend={:?}",
            diagnostics.xdg_session_type,
            diagnostics.effective_disable_dmabuf_renderer,
            diagnostics.effective_disable_compositing_mode,
            diagnostics.gdk_backend
        );
        for warning in &diagnostics.warnings {
            eprintln!("Runtime warning: {warning}");
        }
    }
}

pub fn runtime_settings() -> RuntimeSettings {
    load_runtime_settings_inner().0
}

pub fn runtime_diagnostics() -> RuntimeDiagnostics {
    let (settings, config_exists) = load_runtime_settings_inner();
    build_diagnostics(
        settings,
        config_exists,
        if config_exists { "config" } else { "defaults" },
    )
}

pub fn save_runtime_settings(settings: RuntimeSettings) -> anyhow::Result<RuntimeSaveResult> {
    let config_path = runtime_config_path();
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create runtime config dir {:?}", parent))?;
    }
    let content = serde_json::to_string_pretty(&settings)?;
    std::fs::write(&config_path, content)
        .with_context(|| format!("Failed to write runtime config {:?}", config_path))?;

    Ok(RuntimeSaveResult {
        settings,
        config_path: config_path.to_string_lossy().to_string(),
        restart_required: true,
    })
}

pub fn reset_runtime_settings() -> anyhow::Result<RuntimeSaveResult> {
    save_runtime_settings(RuntimeSettings::default())
}
