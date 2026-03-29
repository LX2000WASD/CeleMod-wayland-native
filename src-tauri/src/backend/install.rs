use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::backend::{blacklist, mods, online, paths};

static DOWNLOAD_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InstallProfileBehavior {
    KeepEnabled,
    ApplySelectedProfile,
    DisableInAllProfiles,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallModResult {
    pub installed_mod: mods::InstalledMod,
    pub saved_path: String,
    pub replaced_files: Vec<String>,
    pub updated_profiles: Vec<String>,
    pub applied_profile: Option<String>,
    pub install_profile_behavior: InstallProfileBehavior,
    pub dependency_results: Vec<DependencyInstallResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInstallResult {
    pub name: String,
    pub required_version: String,
    pub resolved_version: Option<String>,
    pub status: String,
    pub saved_path: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdateInfo {
    pub name: String,
    pub file: String,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyIssue {
    pub name: String,
    pub required_version: String,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub status: String,
    pub required_by: Vec<String>,
    pub download_url: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMaintenance {
    pub available_updates: Vec<ModUpdateInfo>,
    pub dependency_issues: Vec<DependencyIssue>,
}

#[derive(Debug, Clone)]
struct DependencyIssueAccumulator {
    required_version: String,
    installed_version: Option<String>,
    required_by: BTreeSet<String>,
}

fn temporary_download_path() -> anyhow::Result<PathBuf> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock drifted before unix epoch")?
        .as_millis();
    let sequence = DOWNLOAD_COUNTER.fetch_add(1, Ordering::Relaxed);
    let downloads_dir = paths::app_data_dir_path().join("downloads");
    fs::create_dir_all(&downloads_dir)
        .with_context(|| format!("Failed to create {}", downloads_dir.display()))?;
    Ok(downloads_dir.join(format!("download-{timestamp}-{sequence}.zip")))
}

fn download_with_curl(url: &str, destination: &Path) -> anyhow::Result<()> {
    let status = Command::new("curl")
        .arg("--fail")
        .arg("--location")
        .arg("--silent")
        .arg("--show-error")
        .arg("--user-agent")
        .arg(format!(
            "CeleMod-Wayland-Native/{} {}",
            env!("CARGO_PKG_VERSION"),
            env!("GIT_HASH")
        ))
        .arg("--output")
        .arg(destination)
        .arg(url)
        .status()
        .with_context(|| {
            "Failed to launch curl. This fork currently uses the system curl command for URL installs."
        })?;

    if !status.success() {
        bail!("curl failed while downloading {url}");
    }
    Ok(())
}

fn normalize_selected_profile_name(selected_profile_name: Option<&str>) -> Option<String> {
    selected_profile_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
}

fn apply_post_install_behavior(
    game_path: &str,
    installed_mod: &mods::InstalledMod,
    install_profile_behavior: InstallProfileBehavior,
    selected_profile_name: Option<&str>,
    always_on_mods: &[String],
) -> anyhow::Result<(Vec<String>, Option<String>)> {
    match install_profile_behavior {
        InstallProfileBehavior::KeepEnabled => Ok((Vec::new(), None)),
        InstallProfileBehavior::ApplySelectedProfile => {
            let applied_profile = normalize_selected_profile_name(selected_profile_name)
                .or_else(|| blacklist::get_current_profile(game_path).ok());

            if let Some(profile_name) = applied_profile.clone() {
                blacklist::apply_mod_blacklist_profile(game_path, &profile_name, always_on_mods)?;
            }

            Ok((Vec::new(), applied_profile))
        }
        InstallProfileBehavior::DisableInAllProfiles => {
            let profiles = blacklist::get_mod_blacklist_profiles(game_path)?;
            let mut updated_profiles = Vec::new();

            for profile in profiles {
                blacklist::switch_mod_blacklist_profile(
                    game_path,
                    &profile.name,
                    vec![blacklist::ModBlacklistEntry {
                        name: installed_mod.name.clone(),
                        file: installed_mod.file.clone(),
                    }],
                    false,
                )?;
                updated_profiles.push(profile.name);
            }

            let applied_profile = blacklist::get_current_profile(game_path).ok();
            if let Some(profile_name) = applied_profile.clone() {
                blacklist::apply_mod_blacklist_profile(game_path, &profile_name, always_on_mods)?;
            }

            Ok((updated_profiles, applied_profile))
        }
    }
}

fn compare_versions(left: &str, right: &str) -> i32 {
    fn part_value(version: &str, index: usize) -> i32 {
        version
            .split('.')
            .nth(index)
            .map(|part| {
                part.chars()
                    .take_while(|character| character.is_ascii_digit())
                    .collect::<String>()
                    .parse::<i32>()
                    .unwrap_or(0)
            })
            .unwrap_or(0)
    }

    let max_parts = left.split('.').count().max(right.split('.').count());
    for index in 0..max_parts {
        let left_value = part_value(left, index);
        let right_value = part_value(right, index);
        if left_value > right_value {
            return 1;
        }
        if left_value < right_value {
            return -1;
        }
    }
    0
}

fn install_archive_without_dependencies(
    game_path: &str,
    archive_path: &Path,
    install_profile_behavior: InstallProfileBehavior,
    selected_profile_name: Option<&str>,
    always_on_mods: &[String],
) -> anyhow::Result<InstallModResult> {
    if !paths::verify_celeste_install(game_path) {
        bail!("{game_path} is not a valid Celeste install");
    }

    let inspected_mod = mods::inspect_mod_path(archive_path)?;
    let file_name = format!(
        "{}.zip",
        mods::make_path_compatible_name(&inspected_mod.name)
    );
    let target_path = mods::mods_dir_path(game_path).join(&file_name);

    fs::create_dir_all(mods::mods_dir_path(game_path)).with_context(|| {
        format!(
            "Failed to ensure {}",
            mods::mods_dir_path(game_path).display()
        )
    })?;
    fs::copy(archive_path, &target_path)
        .with_context(|| format!("Failed to copy mod archive to {}", target_path.display()))?;

    let replaced_files =
        mods::remove_mod_by_name(game_path, &inspected_mod.name, Some(&file_name))?;
    let installed_mod = mods::inspect_mod_path(&target_path)?;
    let (updated_profiles, applied_profile) = apply_post_install_behavior(
        game_path,
        &installed_mod,
        install_profile_behavior,
        selected_profile_name,
        always_on_mods,
    )?;

    Ok(InstallModResult {
        installed_mod,
        saved_path: target_path.to_string_lossy().to_string(),
        replaced_files,
        updated_profiles,
        applied_profile,
        install_profile_behavior,
        dependency_results: Vec::new(),
    })
}

fn resolve_and_install_dependencies(
    game_path: &str,
    installed_mod: &mods::InstalledMod,
    install_profile_behavior: InstallProfileBehavior,
    selected_profile_name: Option<&str>,
    always_on_mods: &[String],
    mod_index: &HashMap<String, online::OnlineModIndexEntry>,
    visited_mods: &mut HashSet<String>,
) -> anyhow::Result<Vec<DependencyInstallResult>> {
    let mut results = Vec::new();

    for dependency in installed_mod
        .deps
        .iter()
        .filter(|dependency| !dependency.optional)
    {
        let currently_installed = mods::get_installed_mods(game_path)?
            .into_iter()
            .find(|installed| installed.name == dependency.name);

        if let Some(installed_dependency) = currently_installed {
            if compare_versions(&installed_dependency.version, &dependency.version) >= 0 {
                visited_mods.insert(installed_dependency.name.clone());
                results.push(DependencyInstallResult {
                    name: dependency.name.clone(),
                    required_version: dependency.version.clone(),
                    resolved_version: Some(installed_dependency.version),
                    status: "alreadySatisfied".to_string(),
                    saved_path: None,
                    note: None,
                });
                continue;
            }
        }

        if visited_mods.contains(&dependency.name) {
            results.push(DependencyInstallResult {
                name: dependency.name.clone(),
                required_version: dependency.version.clone(),
                resolved_version: None,
                status: "skippedVisited".to_string(),
                saved_path: None,
                note: Some("该依赖已在本次安装流程中处理过。".to_string()),
            });
            continue;
        }

        let Some(index_entry) = mod_index.get(&dependency.name) else {
            results.push(DependencyInstallResult {
                name: dependency.name.clone(),
                required_version: dependency.version.clone(),
                resolved_version: None,
                status: "unresolved".to_string(),
                saved_path: None,
                note: Some("在线索引中没有找到该依赖。".to_string()),
            });
            continue;
        };

        let temporary_path = temporary_download_path()?;
        if let Err(error) = download_with_curl(&index_entry.download_url, &temporary_path) {
            let _ = fs::remove_file(&temporary_path);
            results.push(DependencyInstallResult {
                name: dependency.name.clone(),
                required_version: dependency.version.clone(),
                resolved_version: Some(index_entry.version.clone()),
                status: "failed".to_string(),
                saved_path: None,
                note: Some(error.to_string()),
            });
            continue;
        }

        let install_result = install_archive_without_dependencies(
            game_path,
            &temporary_path,
            install_profile_behavior,
            selected_profile_name,
            always_on_mods,
        );
        let _ = fs::remove_file(&temporary_path);

        match install_result {
            Ok(install_result) => {
                visited_mods.insert(install_result.installed_mod.name.clone());
                results.push(DependencyInstallResult {
                    name: dependency.name.clone(),
                    required_version: dependency.version.clone(),
                    resolved_version: Some(install_result.installed_mod.version.clone()),
                    status: "installed".to_string(),
                    saved_path: Some(install_result.saved_path.clone()),
                    note: None,
                });
                results.extend(resolve_and_install_dependencies(
                    game_path,
                    &install_result.installed_mod,
                    install_profile_behavior,
                    selected_profile_name,
                    always_on_mods,
                    mod_index,
                    visited_mods,
                )?);
            }
            Err(error) => {
                results.push(DependencyInstallResult {
                    name: dependency.name.clone(),
                    required_version: dependency.version.clone(),
                    resolved_version: Some(index_entry.version.clone()),
                    status: "failed".to_string(),
                    saved_path: None,
                    note: Some(error.to_string()),
                });
            }
        }
    }

    Ok(results)
}

fn collect_mod_updates_from_index(
    installed_mods: &[mods::InstalledMod],
    mod_index: &HashMap<String, online::OnlineModIndexEntry>,
) -> Vec<ModUpdateInfo> {
    let mut updates = installed_mods
        .iter()
        .filter_map(|installed_mod| {
            let latest = mod_index.get(&installed_mod.name)?;
            if compare_versions(&latest.version, &installed_mod.version) <= 0 {
                return None;
            }

            Some(ModUpdateInfo {
                name: installed_mod.name.clone(),
                file: installed_mod.file.clone(),
                current_version: installed_mod.version.clone(),
                latest_version: latest.version.clone(),
                download_url: latest.download_url.clone(),
            })
        })
        .collect::<Vec<_>>();

    updates.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    updates
}

fn collect_dependency_issues_from_index(
    installed_mods: &[mods::InstalledMod],
    mod_index: &HashMap<String, online::OnlineModIndexEntry>,
) -> Vec<DependencyIssue> {
    let installed_versions = installed_mods
        .iter()
        .map(|installed_mod| (installed_mod.name.clone(), installed_mod.version.clone()))
        .collect::<HashMap<_, _>>();

    let mut issues = HashMap::<String, DependencyIssueAccumulator>::new();

    for installed_mod in installed_mods {
        for dependency in installed_mod
            .deps
            .iter()
            .filter(|dependency| !dependency.optional)
        {
            let installed_version = installed_versions.get(&dependency.name).cloned();
            let dependency_satisfied = installed_version
                .as_deref()
                .is_some_and(|version| compare_versions(version, &dependency.version) >= 0);

            if dependency_satisfied {
                continue;
            }

            let entry = issues.entry(dependency.name.clone()).or_insert_with(|| {
                DependencyIssueAccumulator {
                    required_version: dependency.version.clone(),
                    installed_version: installed_version.clone(),
                    required_by: BTreeSet::new(),
                }
            });

            if compare_versions(&dependency.version, &entry.required_version) > 0 {
                entry.required_version = dependency.version.clone();
            }

            if entry.installed_version.is_none() {
                entry.installed_version = installed_version.clone();
            }

            entry.required_by.insert(installed_mod.name.clone());
        }
    }

    let mut result = issues
        .into_iter()
        .map(|(name, issue)| {
            let online_entry = mod_index.get(&name);
            let latest_version = online_entry.map(|entry| entry.version.clone());
            let download_url = online_entry.map(|entry| entry.download_url.clone());

            let (status, note) = match (&issue.installed_version, online_entry) {
                (None, Some(_)) => ("missing".to_string(), None),
                (None, None) => (
                    "unavailable".to_string(),
                    Some("在线索引中没有找到该依赖。".to_string()),
                ),
                (Some(_), Some(entry)) => {
                    if compare_versions(&entry.version, &issue.required_version) < 0 {
                        (
                            "outdated".to_string(),
                            Some(format!(
                                "线上最新版本 {} 仍低于所需版本 {}。",
                                entry.version, issue.required_version
                            )),
                        )
                    } else {
                        ("outdated".to_string(), None)
                    }
                }
                (Some(_), None) => (
                    "unavailable".to_string(),
                    Some("当前已安装版本低于要求，且在线索引中没有可更新条目。".to_string()),
                ),
            };

            DependencyIssue {
                name,
                required_version: issue.required_version,
                installed_version: issue.installed_version,
                latest_version,
                status,
                required_by: issue.required_by.into_iter().collect(),
                download_url,
                note,
            }
        })
        .collect::<Vec<_>>();

    result.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    result
}

pub fn install_downloaded_mod(
    game_path: &str,
    archive_path: &Path,
    install_profile_behavior: InstallProfileBehavior,
    selected_profile_name: Option<&str>,
    always_on_mods: &[String],
) -> anyhow::Result<InstallModResult> {
    install_archive_without_dependencies(
        game_path,
        archive_path,
        install_profile_behavior,
        selected_profile_name,
        always_on_mods,
    )
}

pub fn install_mod_from_url(
    game_path: &str,
    url: &str,
    install_profile_behavior: InstallProfileBehavior,
    selected_profile_name: Option<String>,
    install_dependencies: bool,
    always_on_mods: Vec<String>,
    download_mirror: online::DownloadMirror,
) -> anyhow::Result<InstallModResult> {
    let temporary_path = temporary_download_path()?;
    let download_result = download_with_curl(url, &temporary_path);
    if let Err(error) = download_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    let mut install_result = install_downloaded_mod(
        game_path,
        &temporary_path,
        install_profile_behavior,
        selected_profile_name.as_deref(),
        &always_on_mods,
    );
    let _ = fs::remove_file(&temporary_path);

    if install_dependencies {
        let mod_index = online::get_online_mod_index(download_mirror)?;
        let mut visited_mods = HashSet::new();
        let root_name = install_result
            .as_ref()
            .map(|result| result.installed_mod.name.clone())
            .unwrap_or_default();
        if !root_name.is_empty() {
            visited_mods.insert(root_name);
        }

        if let Ok(result) = &mut install_result {
            result.dependency_results = resolve_and_install_dependencies(
                game_path,
                &result.installed_mod,
                install_profile_behavior,
                selected_profile_name.as_deref(),
                &always_on_mods,
                &mod_index,
                &mut visited_mods,
            )?;
        }
    }

    install_result
}

pub fn get_workspace_maintenance(
    game_path: &str,
    download_mirror: online::DownloadMirror,
) -> anyhow::Result<WorkspaceMaintenance> {
    if !paths::verify_celeste_install(game_path) {
        bail!("{game_path} is not a valid Celeste install");
    }

    let installed_mods = mods::get_installed_mods(game_path)?;
    let mod_index = online::get_online_mod_index(download_mirror)?;

    Ok(WorkspaceMaintenance {
        available_updates: collect_mod_updates_from_index(&installed_mods, &mod_index),
        dependency_issues: collect_dependency_issues_from_index(&installed_mods, &mod_index),
    })
}

pub fn update_mod_by_name(
    game_path: &str,
    mod_name: &str,
    install_profile_behavior: InstallProfileBehavior,
    selected_profile_name: Option<String>,
    install_dependencies: bool,
    always_on_mods: Vec<String>,
    download_mirror: online::DownloadMirror,
) -> anyhow::Result<InstallModResult> {
    if !paths::verify_celeste_install(game_path) {
        bail!("{game_path} is not a valid Celeste install");
    }

    let installed_mod = mods::get_installed_mods(game_path)?
        .into_iter()
        .find(|installed_mod| installed_mod.name == mod_name)
        .with_context(|| format!("Mod {mod_name} is not installed"))?;
    let mod_index = online::get_online_mod_index(download_mirror)?;
    let latest_entry = mod_index
        .get(mod_name)
        .with_context(|| format!("Online index does not contain {mod_name}"))?;

    if compare_versions(&latest_entry.version, &installed_mod.version) <= 0 {
        bail!(
            "{mod_name} is already at the latest known version {}",
            installed_mod.version
        );
    }

    install_mod_from_url(
        game_path,
        &latest_entry.download_url,
        install_profile_behavior,
        selected_profile_name,
        install_dependencies,
        always_on_mods,
        download_mirror,
    )
}

pub fn repair_dependency_issues(
    game_path: &str,
    install_profile_behavior: InstallProfileBehavior,
    selected_profile_name: Option<String>,
    always_on_mods: Vec<String>,
    download_mirror: online::DownloadMirror,
) -> anyhow::Result<Vec<DependencyInstallResult>> {
    if !paths::verify_celeste_install(game_path) {
        bail!("{game_path} is not a valid Celeste install");
    }

    let installed_mods = mods::get_installed_mods(game_path)?;
    let mod_index = online::get_online_mod_index(download_mirror)?;
    let issues = collect_dependency_issues_from_index(&installed_mods, &mod_index);
    let mut visited_mods = HashSet::new();
    let mut results = Vec::new();

    for issue in issues {
        results.extend(repair_dependency_issue_from_issue(
            game_path,
            issue,
            install_profile_behavior,
            selected_profile_name.as_deref(),
            &always_on_mods,
            &mod_index,
            &mut visited_mods,
        )?);
    }

    Ok(results)
}

fn repair_dependency_issue_from_issue(
    game_path: &str,
    issue: DependencyIssue,
    install_profile_behavior: InstallProfileBehavior,
    selected_profile_name: Option<&str>,
    always_on_mods: &[String],
    mod_index: &HashMap<String, online::OnlineModIndexEntry>,
    visited_mods: &mut HashSet<String>,
) -> anyhow::Result<Vec<DependencyInstallResult>> {
    let mut results = Vec::new();

    let Some(index_entry) = mod_index.get(&issue.name) else {
        results.push(DependencyInstallResult {
            name: issue.name,
            required_version: issue.required_version,
            resolved_version: issue.installed_version,
            status: "unresolved".to_string(),
            saved_path: None,
            note: issue.note,
        });
        return Ok(results);
    };

    if compare_versions(&index_entry.version, &issue.required_version) < 0 {
        results.push(DependencyInstallResult {
            name: issue.name,
            required_version: issue.required_version.clone(),
            resolved_version: Some(index_entry.version.clone()),
            status: "unresolved".to_string(),
            saved_path: None,
            note: Some(format!(
                "线上最新版本 {} 仍低于所需版本 {}。",
                index_entry.version, issue.required_version
            )),
        });
        return Ok(results);
    }

    let temporary_path = temporary_download_path()?;
    if let Err(error) = download_with_curl(&index_entry.download_url, &temporary_path) {
        let _ = fs::remove_file(&temporary_path);
        results.push(DependencyInstallResult {
            name: issue.name,
            required_version: issue.required_version,
            resolved_version: Some(index_entry.version.clone()),
            status: "failed".to_string(),
            saved_path: None,
            note: Some(error.to_string()),
        });
        return Ok(results);
    }

    let install_result = install_archive_without_dependencies(
        game_path,
        &temporary_path,
        install_profile_behavior,
        selected_profile_name,
        always_on_mods,
    );
    let _ = fs::remove_file(&temporary_path);

    match install_result {
        Ok(install_result) => {
            visited_mods.insert(install_result.installed_mod.name.clone());
            results.push(DependencyInstallResult {
                name: issue.name,
                required_version: issue.required_version.clone(),
                resolved_version: Some(install_result.installed_mod.version.clone()),
                status: "installed".to_string(),
                saved_path: Some(install_result.saved_path.clone()),
                note: None,
            });
            results.extend(resolve_and_install_dependencies(
                game_path,
                &install_result.installed_mod,
                install_profile_behavior,
                selected_profile_name,
                always_on_mods,
                mod_index,
                visited_mods,
            )?);
        }
        Err(error) => {
            results.push(DependencyInstallResult {
                name: issue.name,
                required_version: issue.required_version,
                resolved_version: Some(index_entry.version.clone()),
                status: "failed".to_string(),
                saved_path: None,
                note: Some(error.to_string()),
            });
        }
    }

    Ok(results)
}

pub fn repair_dependency_issue_by_name(
    game_path: &str,
    dependency_name: &str,
    install_profile_behavior: InstallProfileBehavior,
    selected_profile_name: Option<String>,
    always_on_mods: Vec<String>,
    download_mirror: online::DownloadMirror,
) -> anyhow::Result<Vec<DependencyInstallResult>> {
    if !paths::verify_celeste_install(game_path) {
        bail!("{game_path} is not a valid Celeste install");
    }

    let installed_mods = mods::get_installed_mods(game_path)?;
    let mod_index = online::get_online_mod_index(download_mirror)?;
    let issue = collect_dependency_issues_from_index(&installed_mods, &mod_index)
        .into_iter()
        .find(|issue| issue.name == dependency_name)
        .with_context(|| format!("Dependency issue {dependency_name} was not found"))?;
    let mut visited_mods = HashSet::new();

    repair_dependency_issue_from_issue(
        game_path,
        issue,
        install_profile_behavior,
        selected_profile_name.as_deref(),
        &always_on_mods,
        &mod_index,
        &mut visited_mods,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    struct TestGameDir {
        path: PathBuf,
    }

    impl TestGameDir {
        fn new() -> Self {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock drift")
                .as_nanos();
            let sequence = DOWNLOAD_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("celemod-install-test-{timestamp}-{sequence}"));
            fs::create_dir_all(path.join("Mods")).expect("failed to create Mods directory");
            fs::write(path.join("Celeste"), b"").expect("failed to create Celeste marker");
            Self { path }
        }

        fn path(&self) -> &str {
            self.path.to_str().expect("temp path should be valid UTF-8")
        }

        fn archive_path(&self, file_name: &str) -> PathBuf {
            self.path.join(file_name)
        }
    }

    impl Drop for TestGameDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn create_mod_zip(target_path: &Path, mod_name: &str, version: &str) {
        create_mod_zip_with_dependencies(
            target_path,
            mod_name,
            version,
            &[("Helper.Mod", "1.2.3")],
        );
    }

    fn create_mod_zip_with_dependencies(
        target_path: &Path,
        mod_name: &str,
        version: &str,
        dependencies: &[(&str, &str)],
    ) {
        let file = fs::File::create(target_path).expect("failed to create sample zip");
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("everest.yaml", options)
            .expect("failed to create everest.yaml entry");
        let dependency_lines = if dependencies.is_empty() {
            String::new()
        } else {
            format!(
                "  Dependencies:\n{}",
                dependencies
                    .iter()
                    .map(|(name, version)| format!(
                        "    - Name: {name}\n      Version: {version}\n"
                    ))
                    .collect::<String>()
            )
        };
        write!(
            zip,
            "- Name: {mod_name}\n  Version: {version}\n{dependency_lines}"
        )
        .expect("failed to write everest.yaml");
        zip.finish().expect("failed to finish zip");
    }

    #[test]
    fn installs_downloaded_mod_and_disables_all_profiles() {
        let game = TestGameDir::new();
        let _ = blacklist::get_mod_blacklist_profiles(game.path())
            .expect("should create Default profile");
        blacklist::new_mod_blacklist_profile(game.path(), "Speedrun")
            .expect("should create extra profile");

        let archive_path = game.archive_path("sample.zip");
        create_mod_zip(&archive_path, "Sample.Mod", "1.0.0");

        let result = install_downloaded_mod(
            game.path(),
            &archive_path,
            InstallProfileBehavior::DisableInAllProfiles,
            Some("Default"),
            &[],
        )
        .expect("install should succeed");
        assert_eq!(result.installed_mod.name, "Sample.Mod");
        assert!(Path::new(&result.saved_path).exists());
        assert_eq!(result.updated_profiles.len(), 2);
        assert_eq!(result.applied_profile, Some("Default".to_string()));

        let profiles =
            blacklist::get_mod_blacklist_profiles(game.path()).expect("profiles should load");
        for profile in profiles {
            assert!(profile.mods.iter().any(|entry| entry.name == "Sample.Mod"));
        }
    }

    #[test]
    fn replaces_existing_mod_with_same_name() {
        let game = TestGameDir::new();
        let old_mod_dir = Path::new(game.path()).join("Mods").join("OldSample");
        fs::create_dir_all(&old_mod_dir).expect("failed to create old mod dir");
        fs::write(
            old_mod_dir.join("everest.yaml"),
            "- Name: Sample.Mod\n  Version: 0.9.0\n",
        )
        .expect("failed to write old everest.yaml");

        let archive_path = game.archive_path("replacement.zip");
        create_mod_zip(&archive_path, "Sample.Mod", "1.1.0");

        let result = install_downloaded_mod(
            game.path(),
            &archive_path,
            InstallProfileBehavior::KeepEnabled,
            Some("Default"),
            &[],
        )
        .expect("install should succeed");
        assert_eq!(result.installed_mod.version, "1.1.0");
        assert!(result.replaced_files.iter().any(|file| file == "OldSample"));

        let installed_mods = mods::get_installed_mods(game.path()).expect("mod scan should work");
        assert_eq!(installed_mods.len(), 1);
        assert_eq!(installed_mods[0].file, "Sample.Mod.zip");
    }

    #[test]
    fn classifies_installed_and_unresolved_dependencies() {
        let game = TestGameDir::new();
        let main_archive = game.archive_path("main.zip");
        create_mod_zip_with_dependencies(
            &main_archive,
            "Root.Mod",
            "1.0.0",
            &[("Helper.Mod", "1.2.3"), ("Extra.Mod", "2.0.0")],
        );
        let helper_archive = game.archive_path("helper.zip");
        create_mod_zip_with_dependencies(&helper_archive, "Helper.Mod", "1.3.0", &[]);

        install_downloaded_mod(
            game.path(),
            &helper_archive,
            InstallProfileBehavior::KeepEnabled,
            Some("Default"),
            &[],
        )
        .expect("helper install should succeed");

        let root_install = install_downloaded_mod(
            game.path(),
            &main_archive,
            InstallProfileBehavior::KeepEnabled,
            Some("Default"),
            &[],
        )
        .expect("root install should succeed");
        let mut visited = HashSet::from([root_install.installed_mod.name.clone()]);

        let results = resolve_and_install_dependencies(
            game.path(),
            &root_install.installed_mod,
            InstallProfileBehavior::KeepEnabled,
            Some("Default"),
            &[],
            &HashMap::new(),
            &mut visited,
        )
        .expect("dependency resolution should succeed");

        assert!(
            results
                .iter()
                .any(|result| result.name == "Helper.Mod" && result.status == "alreadySatisfied")
        );
        assert!(
            results
                .iter()
                .any(|result| result.name == "Extra.Mod" && result.status == "unresolved")
        );
    }

    #[test]
    fn installs_and_applies_selected_profile() {
        let game = TestGameDir::new();
        let _ = blacklist::get_mod_blacklist_profiles(game.path())
            .expect("should create Default profile");
        blacklist::new_mod_blacklist_profile(game.path(), "Playset")
            .expect("should create Playset profile");

        let archive_path = game.archive_path("selected.zip");
        create_mod_zip_with_dependencies(&archive_path, "Selected.Mod", "1.0.0", &[]);

        let result = install_downloaded_mod(
            game.path(),
            &archive_path,
            InstallProfileBehavior::ApplySelectedProfile,
            Some("Playset"),
            &[],
        )
        .expect("install should succeed");

        assert_eq!(result.applied_profile, Some("Playset".to_string()));
        assert!(result.updated_profiles.is_empty());
        assert_eq!(
            blacklist::get_current_profile(game.path()).expect("current profile should resolve"),
            "Playset"
        );
    }
}
