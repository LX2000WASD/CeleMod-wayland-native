use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::backend::paths;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDependency {
    pub name: String,
    pub version: String,
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ModEntryKind {
    Directory,
    Zip,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub name: String,
    pub version: String,
    pub deps: Vec<ModDependency>,
    pub file: String,
    pub size: u64,
    pub entry_kind: ModEntryKind,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum EverestYaml {
    List(Vec<EverestYamlEntry>),
    Single(EverestYamlEntry),
}

#[derive(Debug, Deserialize)]
struct EverestYamlEntry {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Version", default = "yaml_null")]
    version: serde_yaml::Value,
    #[serde(rename = "Dependencies", default)]
    dependencies: Vec<EverestYamlDependency>,
    #[serde(rename = "OptionalDependencies", default)]
    optional_dependencies: Vec<EverestYamlDependency>,
}

#[derive(Debug, Deserialize)]
struct EverestYamlDependency {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Version", default = "yaml_null")]
    version: serde_yaml::Value,
}

fn yaml_null() -> serde_yaml::Value {
    serde_yaml::Value::Null
}

pub fn mods_dir_path(game_path: &str) -> PathBuf {
    Path::new(game_path).join("Mods")
}

fn read_to_string_bom(path: &Path) -> anyhow::Result<String> {
    let mut file = fs::File::open(path)
        .with_context(|| format!("Failed to open yaml file {}", path.display()))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let bytes = bytes
        .strip_prefix("\u{feff}".as_bytes())
        .unwrap_or(bytes.as_slice());
    Ok(String::from_utf8(bytes.to_vec())?)
}

fn parse_version(version: &serde_yaml::Value) -> String {
    if let Some(value) = version.as_f64() {
        return value.to_string();
    }

    let version_text = version.as_str().unwrap_or("1.0.0");
    let start_index = version_text
        .find(|character: char| character.is_ascii_digit())
        .unwrap_or(0);
    let trimmed = &version_text[start_index..];

    if trimmed
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_digit())
    {
        trimmed.to_string()
    } else {
        "1.0.0".to_string()
    }
}

fn parse_yaml_document(content: &str) -> anyhow::Result<EverestYamlEntry> {
    let yaml: EverestYaml = serde_yaml::from_str(content)?;
    match yaml {
        EverestYaml::List(entries) => entries
            .into_iter()
            .next()
            .context("everest.yaml does not contain a primary document"),
        EverestYaml::Single(entry) => Ok(entry),
    }
}

fn yaml_cache_path(zip_path: &Path) -> anyhow::Result<PathBuf> {
    let mods_dir = zip_path
        .parent()
        .context("zip path does not have a parent Mods directory")?;
    let game_dir = mods_dir.parent().unwrap_or(mods_dir);
    let cache_dir = game_dir.join("celemod_yaml_cache");
    fs::create_dir_all(&cache_dir)?;
    Ok(cache_dir.join(
        zip_path
            .with_extension("yaml")
            .file_name()
            .context("zip file name is missing")?,
    ))
}

fn extract_yaml_from_zip(zip_path: &Path, cache_path: &Path) -> anyhow::Result<String> {
    let zipfile = fs::File::open(zip_path)
        .with_context(|| format!("Failed to open zip archive {}", zip_path.display()))?;
    let mut archive = zip::ZipArchive::new(zipfile)
        .with_context(|| format!("Failed to read zip archive {}", zip_path.display()))?;

    let everest_name = archive
        .file_names()
        .find(|name| *name == "everest.yaml" || *name == "everest.yml")
        .context("Failed to find everest.yaml in zip archive")?
        .to_string();

    let mut file = archive.by_name(&everest_name).with_context(|| {
        format!(
            "Failed to open {everest_name} inside {}",
            zip_path.display()
        )
    })?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;

    fs::write(cache_path, &buffer)
        .with_context(|| format!("Failed to write yaml cache {}", cache_path.display()))?;

    let content = String::from_utf8(buffer)?;
    use strip_bom::StripBom;
    Ok(content.strip_bom().to_string())
}

fn read_yaml_from_zip(zip_path: &Path) -> anyhow::Result<String> {
    let cache_path = yaml_cache_path(zip_path)?;
    let zip_modified = fs::metadata(zip_path)
        .and_then(|metadata| metadata.modified())
        .ok();
    let cache_modified = fs::metadata(&cache_path)
        .and_then(|metadata| metadata.modified())
        .ok();

    if cache_path.exists()
        && zip_modified.is_some()
        && cache_modified.is_some()
        && cache_modified >= zip_modified
    {
        return read_to_string_bom(&cache_path);
    }

    extract_yaml_from_zip(zip_path, &cache_path)
}

fn read_yaml_from_directory(directory_path: &Path) -> anyhow::Result<String> {
    let yaml_path = fs::read_dir(directory_path)?
        .filter_map(Result::ok)
        .find(|entry| {
            let name = entry
                .file_name()
                .to_string_lossy()
                .to_string()
                .to_lowercase();
            name == "everest.yaml" || name == "everest.yml"
        })
        .map(|entry| entry.path())
        .context("Failed to find everest.yaml in mod directory")?;

    read_to_string_bom(&yaml_path)
}

pub fn inspect_mod_path(path: &Path) -> anyhow::Result<InstalledMod> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("Failed to inspect mod path {}", path.display()))?;

    let (entry_kind, yaml_content) = if metadata.is_dir() {
        (ModEntryKind::Directory, read_yaml_from_directory(path)?)
    } else if path.extension().and_then(|value| value.to_str()) == Some("zip") {
        (ModEntryKind::Zip, read_yaml_from_zip(path)?)
    } else {
        bail!("{} is not a supported mod entry", path.display());
    };

    let yaml = parse_yaml_document(&yaml_content)
        .with_context(|| format!("Failed to parse {}", path.display()))?;

    let mut deps = Vec::new();
    for dependency in yaml.dependencies {
        deps.push(ModDependency {
            name: dependency.name,
            version: parse_version(&dependency.version),
            optional: false,
        });
    }
    for dependency in yaml.optional_dependencies {
        deps.push(ModDependency {
            name: dependency.name,
            version: parse_version(&dependency.version),
            optional: true,
        });
    }

    Ok(InstalledMod {
        name: yaml.name,
        version: parse_version(&yaml.version),
        deps,
        file: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .context("mod path does not have a file name")?,
        size: metadata.len(),
        entry_kind,
    })
}

fn scan_entry(entry: fs::DirEntry) -> anyhow::Result<Option<InstalledMod>> {
    let path = entry.path();
    match inspect_mod_path(&path) {
        Ok(installed_mod) => Ok(Some(installed_mod)),
        Err(_) => Ok(None),
    }
}

pub fn make_path_compatible_name(name: &str) -> String {
    name.replace([' ', ':', '/', '\\', '?', '*', '\"', '<', '>', '|'], "_")
}

pub fn remove_mod_by_name(
    game_path: &str,
    mod_name: &str,
    keep_file: Option<&str>,
) -> anyhow::Result<Vec<String>> {
    let mut removed = Vec::new();
    for installed_mod in get_installed_mods(game_path)? {
        if installed_mod.name != mod_name {
            continue;
        }
        if keep_file.is_some_and(|keep_file| installed_mod.file == keep_file) {
            continue;
        }

        let path = mods_dir_path(game_path).join(&installed_mod.file);
        if !path.exists() {
            continue;
        }

        if path.is_dir() {
            fs::remove_dir_all(&path)
                .with_context(|| format!("Failed to remove mod directory {}", path.display()))?;
        } else {
            fs::remove_file(&path)
                .with_context(|| format!("Failed to remove mod file {}", path.display()))?;
        }
        removed.push(installed_mod.file);
    }
    Ok(removed)
}

pub fn get_installed_mods(game_path: &str) -> anyhow::Result<Vec<InstalledMod>> {
    if !paths::verify_celeste_install(game_path) {
        bail!("{} is not a valid Celeste install", game_path);
    }

    let mods_dir = mods_dir_path(game_path);
    fs::create_dir_all(&mods_dir)
        .with_context(|| format!("Failed to ensure Mods directory {}", mods_dir.display()))?;

    let mut mods = Vec::new();
    for entry in fs::read_dir(&mods_dir)
        .with_context(|| format!("Failed to read Mods directory {}", mods_dir.display()))?
    {
        let entry = entry?;
        match scan_entry(entry) {
            Ok(Some(installed_mod)) => mods.push(installed_mod),
            Ok(None) => {}
            Err(error) => {
                eprintln!(
                    "Failed to scan mod entry in {}: {error}",
                    mods_dir.display()
                );
            }
        }
    }

    mods.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(mods)
}
