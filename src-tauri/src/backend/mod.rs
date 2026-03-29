pub mod blacklist;
pub mod celeste;
pub mod everest;
pub mod i18n;
pub mod install;
pub mod launch;
pub mod mods;
pub mod online;
pub mod paths;
pub mod runtime;
pub mod uninstall;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub git_hash: String,
}

pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_hash: env!("GIT_HASH").to_string(),
    }
}
