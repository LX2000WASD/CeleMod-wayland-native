mod backend;

#[tauri::command]
fn app_info() -> backend::AppInfo {
    backend::app_info()
}

#[tauri::command]
fn app_paths() -> backend::paths::AppPaths {
    backend::paths::app_paths()
}

#[tauri::command]
fn get_translation_catalog() -> backend::i18n::TranslationCatalog {
    backend::i18n::get_translation_catalog()
}

#[tauri::command]
fn detect_celeste_installs() -> Vec<backend::celeste::CelesteInstall> {
    backend::celeste::detect_celeste_installs()
}

#[tauri::command]
fn verify_celeste_install(path: String) -> bool {
    backend::paths::verify_celeste_install(&path)
}

#[tauri::command]
fn resolve_celeste_path(path: String) -> Option<String> {
    backend::paths::resolve_celeste_path(&path)
}

#[tauri::command]
fn get_everest_version(path: String) -> Option<i32> {
    backend::everest::get_everest_version(&path)
}

#[tauri::command]
fn download_and_install_everest(game_path: String, url: String) -> Result<Option<i32>, String> {
    backend::everest::download_and_install_everest(&game_path, &url)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_game(game_path: String) -> Result<(), String> {
    backend::launch::start_game(&game_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_mods_folder(game_path: String) -> Result<(), String> {
    backend::launch::open_mods_folder(&game_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    backend::launch::open_url(&url).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_installed_mods(path: String) -> Result<Vec<backend::mods::InstalledMod>, String> {
    backend::mods::get_installed_mods(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_mods(
    game_path: String,
    mod_names: Vec<String>,
    always_on_mods: Vec<String>,
) -> Result<backend::uninstall::DeleteModsResult, String> {
    backend::uninstall::delete_mods(&game_path, mod_names, always_on_mods)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn install_mod_from_url(
    game_path: String,
    url: String,
    install_profile_behavior: backend::install::InstallProfileBehavior,
    selected_profile_name: Option<String>,
    install_dependencies: bool,
    always_on_mods: Vec<String>,
    download_mirror: backend::online::DownloadMirror,
) -> Result<backend::install::InstallModResult, String> {
    backend::install::install_mod_from_url(
        &game_path,
        &url,
        install_profile_behavior,
        selected_profile_name,
        install_dependencies,
        always_on_mods,
        download_mirror,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_workspace_maintenance(
    game_path: String,
    download_mirror: backend::online::DownloadMirror,
) -> Result<backend::install::WorkspaceMaintenance, String> {
    backend::install::get_workspace_maintenance(&game_path, download_mirror)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_mod_by_name(
    game_path: String,
    mod_name: String,
    install_profile_behavior: backend::install::InstallProfileBehavior,
    selected_profile_name: Option<String>,
    install_dependencies: bool,
    always_on_mods: Vec<String>,
    download_mirror: backend::online::DownloadMirror,
) -> Result<backend::install::InstallModResult, String> {
    backend::install::update_mod_by_name(
        &game_path,
        &mod_name,
        install_profile_behavior,
        selected_profile_name,
        install_dependencies,
        always_on_mods,
        download_mirror,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn repair_dependency_issues(
    game_path: String,
    install_profile_behavior: backend::install::InstallProfileBehavior,
    selected_profile_name: Option<String>,
    always_on_mods: Vec<String>,
    download_mirror: backend::online::DownloadMirror,
) -> Result<Vec<backend::install::DependencyInstallResult>, String> {
    backend::install::repair_dependency_issues(
        &game_path,
        install_profile_behavior,
        selected_profile_name,
        always_on_mods,
        download_mirror,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn repair_dependency_issue_by_name(
    game_path: String,
    dependency_name: String,
    install_profile_behavior: backend::install::InstallProfileBehavior,
    selected_profile_name: Option<String>,
    always_on_mods: Vec<String>,
    download_mirror: backend::online::DownloadMirror,
) -> Result<Vec<backend::install::DependencyInstallResult>, String> {
    backend::install::repair_dependency_issue_by_name(
        &game_path,
        &dependency_name,
        install_profile_behavior,
        selected_profile_name,
        always_on_mods,
        download_mirror,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_online_mods(
    params: backend::online::OnlineModSearchParams,
) -> Result<backend::online::OnlineModSearchResult, String> {
    backend::online::search_online_mods(params).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_blacklist_profiles(
    game_path: String,
) -> Result<Vec<backend::blacklist::ModBlacklistProfile>, String> {
    backend::blacklist::get_mod_blacklist_profiles(&game_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_current_profile(game_path: String) -> Result<String, String> {
    backend::blacklist::get_current_profile(&game_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn apply_blacklist_profile(
    game_path: String,
    profile_name: String,
    always_on_mods: Vec<String>,
) -> Result<(), String> {
    backend::blacklist::apply_mod_blacklist_profile(&game_path, &profile_name, &always_on_mods)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn switch_mod_blacklist_profile(
    game_path: String,
    profile_name: String,
    mods: Vec<backend::blacklist::ModBlacklistEntry>,
    enabled: bool,
) -> Result<(), String> {
    backend::blacklist::switch_mod_blacklist_profile(&game_path, &profile_name, mods, enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn new_mod_blacklist_profile(game_path: String, profile_name: String) -> Result<(), String> {
    backend::blacklist::new_mod_blacklist_profile(&game_path, &profile_name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_mod_blacklist_profile(game_path: String, profile_name: String) -> Result<(), String> {
    backend::blacklist::remove_mod_blacklist_profile(&game_path, &profile_name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_mod_options_order(
    game_path: String,
    profile_name: String,
    order: Vec<String>,
) -> Result<(), String> {
    backend::blacklist::set_mod_options_order(&game_path, &profile_name, order)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_current_blacklist_content(game_path: String) -> Result<String, String> {
    backend::blacklist::get_current_blacklist_content(&game_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn sync_blacklist_profile_from_file(
    game_path: String,
    profile_name: String,
    always_on_mods: Vec<String>,
) -> Result<(), String> {
    backend::blacklist::sync_blacklist_profile_from_file(&game_path, &profile_name, &always_on_mods)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_runtime_settings() -> backend::runtime::RuntimeSettings {
    backend::runtime::runtime_settings()
}

#[tauri::command]
fn get_runtime_diagnostics() -> backend::runtime::RuntimeDiagnostics {
    backend::runtime::runtime_diagnostics()
}

#[tauri::command]
fn save_runtime_settings(
    settings: backend::runtime::RuntimeSettings,
) -> Result<backend::runtime::RuntimeSaveResult, String> {
    backend::runtime::save_runtime_settings(settings).map_err(|error| error.to_string())
}

#[tauri::command]
fn reset_runtime_settings() -> Result<backend::runtime::RuntimeSaveResult, String> {
    backend::runtime::reset_runtime_settings().map_err(|error| error.to_string())
}

fn main() {
    backend::runtime::initialize_runtime();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_info,
            app_paths,
            get_translation_catalog,
            detect_celeste_installs,
            verify_celeste_install,
            resolve_celeste_path,
            get_everest_version,
            download_and_install_everest,
            start_game,
            open_mods_folder,
            open_url,
            get_installed_mods,
            delete_mods,
            install_mod_from_url,
            get_workspace_maintenance,
            update_mod_by_name,
            repair_dependency_issues,
            repair_dependency_issue_by_name,
            search_online_mods,
            get_blacklist_profiles,
            get_current_profile,
            apply_blacklist_profile,
            switch_mod_blacklist_profile,
            new_mod_blacklist_profile,
            remove_mod_blacklist_profile,
            set_mod_options_order,
            get_current_blacklist_content,
            sync_blacklist_profile_from_file,
            get_runtime_settings,
            get_runtime_diagnostics,
            save_runtime_settings,
            reset_runtime_settings,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run CeleMod Wayland Native");
}
