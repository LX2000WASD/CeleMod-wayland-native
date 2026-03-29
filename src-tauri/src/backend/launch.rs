use anyhow::{Context, bail};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::backend::{celeste, mods, paths};

fn spawn_detached(command: &mut Command) -> anyhow::Result<()> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .context("failed to spawn process")
}

fn open_with_desktop(target: &str) -> anyhow::Result<()> {
    let mut xdg_open = Command::new("xdg-open");
    xdg_open.arg(target);
    if spawn_detached(&mut xdg_open).is_ok() {
        return Ok(());
    }

    let mut gio_open = Command::new("gio");
    gio_open.arg("open").arg(target);
    if spawn_detached(&mut gio_open).is_ok() {
        return Ok(());
    }

    bail!("Failed to open target with xdg-open or gio open")
}

fn launch_native_binary(game_path: &Path, binary_path: &Path) -> anyhow::Result<()> {
    let mut command = Command::new(binary_path);
    command.current_dir(game_path);
    spawn_detached(&mut command)
        .with_context(|| format!("failed to launch native binary {}", binary_path.display()))
}

fn native_launch_path(game_path: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        let native_binary = game_path.join("Celeste");
        if native_binary.exists() {
            return Some(native_binary);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let native_binary = game_path.join("Celeste.exe");
        if native_binary.exists() {
            return Some(native_binary);
        }
    }

    None
}

pub fn start_game(game_path: &str) -> anyhow::Result<()> {
    if !paths::verify_celeste_install(game_path) {
        bail!("{game_path} is not a valid Celeste install");
    }

    if let Some(game) = celeste::find_celeste_install_by_path(game_path) {
        game_scanner::manager::launch_game(&game)
            .context("failed to launch detected game install")?;
        return Ok(());
    }

    let game_path = Path::new(game_path);
    if let Some(binary_path) = native_launch_path(game_path) {
        return launch_native_binary(game_path, &binary_path);
    }

    #[cfg(target_os = "linux")]
    if game_path.join("Celeste.exe").exists() {
        bail!(
            "The selected path only contains Celeste.exe and is not tied to a detected launcher install"
        );
    }

    bail!("No launchable Celeste binary was found")
}

pub fn open_mods_folder(game_path: &str) -> anyhow::Result<()> {
    if !paths::verify_celeste_install(game_path) {
        bail!("{game_path} is not a valid Celeste install");
    }

    let mods_dir = mods::mods_dir_path(game_path);
    fs::create_dir_all(&mods_dir)
        .with_context(|| format!("failed to ensure Mods directory {}", mods_dir.display()))?;
    open_with_desktop(&mods_dir.to_string_lossy())
}

pub fn open_url(url: &str) -> anyhow::Result<()> {
    let url = url.trim();
    if url.is_empty() {
        bail!("URL is empty");
    }

    open_with_desktop(url)
}
