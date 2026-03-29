use anyhow::{Context, bail};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::backend::paths;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPack {
    pub code: String,
    pub label: String,
    pub path: String,
    pub messages: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationPackLoadError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationCatalog {
    pub directory: String,
    pub packs: Vec<TranslationPack>,
    pub errors: Vec<TranslationPackLoadError>,
}

fn translation_pack_dir_path() -> PathBuf {
    let dir = paths::app_config_dir_path().join("locales");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn parse_message_map(value: &Value) -> anyhow::Result<HashMap<String, String>> {
    let object = value
        .as_object()
        .with_context(|| "messages must be a JSON object".to_string())?;
    Ok(flatten_message_map(object))
}

fn flatten_message_map(object: &Map<String, Value>) -> HashMap<String, String> {
    object
        .iter()
        .filter_map(|(key, value)| {
            value
                .as_str()
                .map(|translated| (key.clone(), translated.to_string()))
        })
        .collect()
}

fn parse_translation_pack(path: &Path) -> anyhow::Result<TranslationPack> {
    let fallback_code = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::trim)
        .filter(|stem| !stem.is_empty())
        .unwrap_or("custom-pack")
        .to_string();

    let raw = fs::read_to_string(path)
        .with_context(|| format!("Failed to read translation pack {}", path.display()))?;
    let value: Value = serde_json::from_str(&raw)
        .with_context(|| format!("Failed to parse JSON in {}", path.display()))?;
    let object = value
        .as_object()
        .with_context(|| format!("{} must contain a JSON object", path.display()))?;

    let code = object
        .get("code")
        .and_then(Value::as_str)
        .or_else(|| object.get("lang").and_then(Value::as_str))
        .or_else(|| object.get("locale").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&fallback_code)
        .to_string();

    let label = object
        .get("label")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&code)
        .to_string();

    let messages = if let Some(messages) = object.get("messages") {
        parse_message_map(messages)?
    } else {
        let filtered = object
            .iter()
            .filter(|(key, _)| !matches!(key.as_str(), "code" | "lang" | "locale" | "label"))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect::<Map<_, _>>();
        flatten_message_map(&filtered)
    };

    if messages.is_empty() {
        bail!("Translation pack does not contain any messages");
    }

    Ok(TranslationPack {
        code,
        label,
        path: path.to_string_lossy().to_string(),
        messages,
    })
}

pub fn get_translation_catalog() -> TranslationCatalog {
    let directory = translation_pack_dir_path();
    let mut packs = Vec::new();
    let mut errors = Vec::new();

    match fs::read_dir(&directory) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_json = path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("json"));
                if !is_json {
                    continue;
                }

                match parse_translation_pack(&path) {
                    Ok(pack) => packs.push(pack),
                    Err(error) => errors.push(TranslationPackLoadError {
                        path: path.to_string_lossy().to_string(),
                        message: error.to_string(),
                    }),
                }
            }
        }
        Err(error) => errors.push(TranslationPackLoadError {
            path: directory.to_string_lossy().to_string(),
            message: error.to_string(),
        }),
    }

    packs.sort_by(|left, right| left.label.to_lowercase().cmp(&right.label.to_lowercase()));
    errors.sort_by(|left, right| left.path.cmp(&right.path));

    TranslationCatalog {
        directory: directory.to_string_lossy().to_string(),
        packs,
        errors,
    }
}
