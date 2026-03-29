use crate::backend::everest;
use crate::backend::paths;
use game_scanner::prelude::Game;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CelesteInstall {
    pub source: String,
    pub path: String,
    pub valid: bool,
    pub everest_version: Option<i32>,
}

fn push_install(source: &str, game: Game, installs: &mut Vec<CelesteInstall>) {
    let Some(path) = game.path else {
        return;
    };
    let path_string = path.to_string_lossy().to_string();
    installs.push(CelesteInstall {
        source: source.to_string(),
        valid: paths::verify_celeste_install(&path_string),
        everest_version: everest::get_everest_version(&path_string),
        path: path_string,
    });
}

pub fn detect_celeste_installs() -> Vec<CelesteInstall> {
    let mut installs = Vec::new();

    if let Ok(game) = game_scanner::steam::find("504230") {
        push_install("steam", game, &mut installs);
    }

    if let Ok(game) = game_scanner::epicgames::find("9ae799adceab466a97fbc0408d12c5b8") {
        push_install("epic", game, &mut installs);
    }

    installs
}

fn path_matches(game_path: &Path, expected_path: &Path) -> bool {
    if game_path == expected_path {
        return true;
    }

    match (game_path.canonicalize(), expected_path.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

pub fn find_celeste_install_by_path(path: &str) -> Option<Game> {
    let expected_path = Path::new(path);

    if let Ok(game) = game_scanner::steam::find("504230") {
        if game
            .path
            .as_deref()
            .is_some_and(|game_path| path_matches(game_path, expected_path))
        {
            return Some(game);
        }
    }

    if let Ok(game) = game_scanner::epicgames::find("9ae799adceab466a97fbc0408d12c5b8") {
        if game
            .path
            .as_deref()
            .is_some_and(|game_path| path_matches(game_path, expected_path))
        {
            return Some(game);
        }
    }

    None
}
