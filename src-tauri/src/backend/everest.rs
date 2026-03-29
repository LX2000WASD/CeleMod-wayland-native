use anyhow::{Context, bail};
use std::fs;
use std::io;
use std::path::Path;
use std::process::Command;

static MAGIC_STR: &str = "EverestBuild";
static MAGIC_STR_ONLY_ORIGIN_EXE: &str = "_StarJumpEnd+<StartCirclingPlayer>";

pub fn get_everest_version(game_path: &str) -> Option<i32> {
    fn check_file(path: &Path) -> Option<i32> {
        let buffer = std::fs::read(path).ok()?;
        let text = unsafe { std::str::from_utf8_unchecked(&buffer) };
        let position = text.find(MAGIC_STR)?;
        let text = &text[position..];
        let end = text.find('\0')?;
        let text = &text[..end];
        let text = &text[MAGIC_STR.len()..];
        text.parse::<i32>().ok()
    }

    let game_path = Path::new(game_path);
    let exe_path = game_path.join("Celeste.exe");
    let dll_path = game_path.join("Celeste.dll");

    check_file(&exe_path).or_else(|| {
        let buffer = std::fs::read(&exe_path).ok();
        let looks_like_unpatched_exe = buffer.as_ref().is_some_and(|data| {
            data.windows(MAGIC_STR_ONLY_ORIGIN_EXE.len())
                .any(|window| window == MAGIC_STR_ONLY_ORIGIN_EXE.as_bytes())
        });
        if looks_like_unpatched_exe {
            None
        } else {
            check_file(&dll_path)
        }
    })
}

fn make_curl_command() -> Command {
    let mut command = Command::new("curl");
    command
        .arg("--fail")
        .arg("--location")
        .arg("--silent")
        .arg("--show-error")
        .arg("--user-agent")
        .arg(format!(
            "CeleMod-Wayland-Native/{} {}",
            env!("CARGO_PKG_VERSION"),
            env!("GIT_HASH")
        ));
    command
}

fn download_archive(url: &str, target: &Path) -> anyhow::Result<()> {
    let target = target
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("temporary archive path is not valid UTF-8"))?;

    let output = make_curl_command()
        .arg("--output")
        .arg(target)
        .arg(url)
        .output()
        .with_context(|| format!("failed to launch curl for {url}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("curl failed while downloading Everest: {stderr}");
    }

    Ok(())
}

pub fn download_and_install_everest(game_path: &str, url: &str) -> anyhow::Result<Option<i32>> {
    if !crate::backend::paths::verify_celeste_install(game_path) {
        bail!("{game_path} is not a valid Celeste install");
    }

    let archive_path = std::env::temp_dir().join(format!("celemod-everest-{}.zip", std::process::id()));
    download_archive(url, &archive_path)?;

    let install_result = (|| -> anyhow::Result<()> {
        let file = fs::File::open(&archive_path)
            .with_context(|| format!("failed to open downloaded archive {}", archive_path.display()))?;
        let mut archive = zip::ZipArchive::new(file).context("failed to read Everest archive")?;

        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).context("failed to read archive entry")?;
            let mangled_name = entry.mangled_name();
            let Ok(relative_path) = mangled_name.strip_prefix("main/") else {
                continue;
            };
            let output_path = Path::new(game_path).join(relative_path);

            if entry.name().ends_with('/') {
                fs::create_dir_all(&output_path)
                    .with_context(|| format!("failed to create directory {}", output_path.display()))?;
                continue;
            }

            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("failed to create directory {}", parent.display()))?;
            }

            let mut output_file = fs::File::create(&output_path)
                .with_context(|| format!("failed to create file {}", output_path.display()))?;
            io::copy(&mut entry, &mut output_file)
                .with_context(|| format!("failed to extract {}", output_path.display()))?;

            #[cfg(unix)]
            if let Some(mode) = entry.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                let permissions = fs::Permissions::from_mode(mode);
                fs::set_permissions(&output_path, permissions)
                    .with_context(|| format!("failed to set permissions on {}", output_path.display()))?;
            }
        }

        Ok(())
    })();

    let _ = fs::remove_file(&archive_path);
    install_result?;

    Ok(get_everest_version(game_path))
}
