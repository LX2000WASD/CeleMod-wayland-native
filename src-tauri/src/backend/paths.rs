use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub config_dir: String,
    pub data_dir: String,
}

fn ensure_dir(path: PathBuf) -> PathBuf {
    let _ = std::fs::create_dir_all(&path);
    path
}

pub fn app_config_dir_path() -> PathBuf {
    dirs::config_dir()
        .map(|path| ensure_dir(path.join("celemod-wayland-native")))
        .unwrap_or_else(|| ensure_dir(PathBuf::from("./.celemod-wayland-native/config")))
}

pub fn app_data_dir_path() -> PathBuf {
    dirs::data_dir()
        .map(|path| ensure_dir(path.join("celemod-wayland-native")))
        .unwrap_or_else(|| ensure_dir(PathBuf::from("./.celemod-wayland-native/data")))
}

pub fn app_paths() -> AppPaths {
    let config_dir = app_config_dir_path();
    let data_dir = app_data_dir_path();

    AppPaths {
        config_dir: config_dir.to_string_lossy().to_string(),
        data_dir: data_dir.to_string_lossy().to_string(),
    }
}

fn strip_wrapping_quotes(path: &str) -> &str {
    let trimmed = path.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0];
        let last = bytes[trimmed.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &trimmed[1..trimmed.len() - 1];
        }
    }
    trimmed
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hi = bytes[index + 1] as char;
            let lo = bytes[index + 2] as char;
            if let (Some(hi), Some(lo)) = (hi.to_digit(16), lo.to_digit(16)) {
                decoded.push(((hi << 4) | lo) as u8);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn decode_file_url(path: &str) -> Option<String> {
    let raw = path.strip_prefix("file://")?;
    let raw = raw.strip_prefix("localhost").unwrap_or(raw);
    Some(percent_decode(raw))
}

fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }

    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home_dir) = dirs::home_dir() {
            return home_dir.join(rest);
        }
    }

    PathBuf::from(path)
}

fn is_celeste_binary_name(path: &Path) -> bool {
    path.file_name()
        .map(|name| {
            let name = name.to_string_lossy().to_ascii_lowercase();
            name == "celeste" || name == "celeste.exe"
        })
        .unwrap_or(false)
}

pub fn resolve_celeste_path(path: &str) -> Option<String> {
    let stripped = strip_wrapping_quotes(path);
    if stripped.is_empty() {
        return None;
    }

    let decoded = decode_file_url(stripped).unwrap_or_else(|| stripped.to_string());
    let expanded = expand_tilde(decoded.trim());
    let candidate = if is_celeste_binary_name(&expanded) {
        expanded.parent().map(Path::to_path_buf).unwrap_or(expanded)
    } else {
        expanded
    };
    let normalized = candidate.canonicalize().unwrap_or(candidate);
    Some(normalized.to_string_lossy().to_string())
}

pub fn verify_celeste_install(path: &str) -> bool {
    let Some(path) = resolve_celeste_path(path) else {
        return false;
    };
    let path = Path::new(&path);
    ["Celeste", "Celeste.exe"]
        .iter()
        .any(|name| path.join(name).exists())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_test_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("celemod-wayland-paths-{label}-{nonce}"));
        fs::create_dir_all(&dir).expect("test directory should be created");
        dir
    }

    #[test]
    fn resolves_executable_path_to_parent_directory() {
        let dir = make_test_dir("exe-parent");
        fs::write(dir.join("Celeste.exe"), b"").expect("marker file should be created");

        let resolved = resolve_celeste_path(&dir.join("Celeste.exe").to_string_lossy())
            .expect("path should resolve");

        assert_eq!(Path::new(&resolved), dir.as_path());
    }

    #[test]
    fn verifies_file_url_and_wrapped_paths() {
        let dir = make_test_dir("file-url");
        fs::write(dir.join("Celeste.exe"), b"").expect("marker file should be created");

        let file_url = format!("file://{}", dir.join("Celeste.exe").to_string_lossy());
        assert!(verify_celeste_install(&file_url));

        let wrapped = format!("\"{}\"", dir.to_string_lossy());
        assert!(verify_celeste_install(&wrapped));
    }
}
