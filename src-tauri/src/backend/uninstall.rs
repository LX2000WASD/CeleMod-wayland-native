use anyhow::bail;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;

use crate::backend::{blacklist, mods, paths};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteModsResult {
    pub removed_mod_names: Vec<String>,
    pub removed_files: Vec<String>,
    pub updated_profiles: Vec<String>,
}

pub fn delete_mods(
    game_path: &str,
    mod_names: Vec<String>,
    always_on_mods: Vec<String>,
) -> anyhow::Result<DeleteModsResult> {
    if !paths::verify_celeste_install(game_path) {
        bail!("{game_path} is not a valid Celeste install");
    }

    let requested_names = mod_names
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect::<HashSet<_>>();

    if requested_names.is_empty() {
        bail!("No mod names were provided");
    }

    let installed_mods = mods::get_installed_mods(game_path)?;
    let targets = installed_mods
        .into_iter()
        .filter(|installed_mod| requested_names.contains(&installed_mod.name))
        .collect::<Vec<_>>();

    if targets.is_empty() {
        bail!("No installed mods matched the requested names");
    }

    let mut removed_names = HashSet::new();
    let mut removed_files = HashSet::new();

    for target in targets {
        let path = mods::mods_dir_path(game_path).join(&target.file);
        if path.exists() {
            if path.is_dir() {
                fs::remove_dir_all(&path)?;
            } else {
                fs::remove_file(&path)?;
            }
        }
        removed_names.insert(target.name);
        removed_files.insert(target.file);
    }

    let mut updated_profiles = blacklist::remove_mods_from_profiles(
        game_path,
        &removed_names,
        &removed_files,
        &always_on_mods,
    )?;
    updated_profiles.sort();

    let mut removed_mod_names = removed_names.into_iter().collect::<Vec<_>>();
    removed_mod_names.sort();
    let mut removed_files = removed_files.into_iter().collect::<Vec<_>>();
    removed_files.sort();

    Ok(DeleteModsResult {
        removed_mod_names,
        removed_files,
        updated_profiles,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::blacklist;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestGameDir {
        path: PathBuf,
    }

    impl TestGameDir {
        fn new() -> Self {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock drift")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("celemod-uninstall-test-{timestamp}"));
            fs::create_dir_all(path.join("Mods")).expect("failed to create Mods directory");
            fs::write(path.join("Celeste"), b"").expect("failed to create Celeste marker");
            Self { path }
        }

        fn path(&self) -> &str {
            self.path.to_str().expect("temp path should be valid UTF-8")
        }
    }

    impl Drop for TestGameDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_sample_mod(game: &TestGameDir, dir_name: &str, mod_name: &str) {
        let mod_dir = Path::new(game.path()).join("Mods").join(dir_name);
        fs::create_dir_all(&mod_dir).expect("failed to create sample mod");
        fs::write(
            mod_dir.join("everest.yaml"),
            format!("- Name: {mod_name}\n  Version: 1.0.0\n"),
        )
        .expect("failed to write sample everest.yaml");
    }

    #[test]
    fn deletes_mods_and_cleans_profiles() {
        let game = TestGameDir::new();
        write_sample_mod(&game, "AlphaPack", "Alpha.Mod");
        write_sample_mod(&game, "BetaPack", "Beta.Mod");

        blacklist::new_mod_blacklist_profile(game.path(), "Playset")
            .expect("profile creation should work");
        blacklist::switch_mod_blacklist_profile(
            game.path(),
            "Playset",
            vec![blacklist::ModBlacklistEntry {
                name: "Alpha.Mod".to_string(),
                file: "AlphaPack".to_string(),
            }],
            false,
        )
        .expect("should update profile");
        blacklist::set_mod_options_order(
            game.path(),
            "Playset",
            vec!["AlphaPack".to_string(), "BetaPack".to_string()],
        )
        .expect("order update should work");
        blacklist::apply_mod_blacklist_profile(game.path(), "Playset", &[])
            .expect("apply should work");

        let result = delete_mods(game.path(), vec!["Alpha.Mod".to_string()], Vec::new())
            .expect("delete should work");

        assert_eq!(result.removed_mod_names, vec!["Alpha.Mod".to_string()]);
        assert_eq!(result.removed_files, vec!["AlphaPack".to_string()]);
        assert!(result.updated_profiles.contains(&"Playset".to_string()));

        let profiles =
            blacklist::get_mod_blacklist_profiles(game.path()).expect("profiles should load");
        let playset = profiles
            .into_iter()
            .find(|profile| profile.name == "Playset")
            .expect("Playset should exist");
        assert!(playset.mods.iter().all(|entry| entry.name != "Alpha.Mod"));
        assert!(
            playset
                .mod_options_order
                .iter()
                .all(|file| file != "AlphaPack")
        );
    }
}
