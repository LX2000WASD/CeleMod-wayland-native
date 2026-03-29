#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
subcommand="${1:-}"

# Keep Cargo caches local to the repository to avoid polluting the host.
export CARGO_HOME="${CARGO_HOME:-$repo_root/.cargo-home}"

# linuxdeploy ships GNU strip 2.35, which fails on Arch/Garuda system libraries
# that contain RELR sections. Skipping strip keeps AppImage bundling working.
if [[ "$subcommand" == "build" && -z "${NO_STRIP+x}" ]]; then
  export NO_STRIP=1
fi

args=("$@")
if [[ "${#args[@]}" -ge 2 && "${args[1]}" == "--" ]]; then
  args=("${args[0]}" "${args[@]:2}")
fi

cd "$repo_root"
exec "$repo_root/node_modules/.bin/tauri" "${args[@]}"
