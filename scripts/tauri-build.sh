#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
args=("$@")

if [[ "${#args[@]}" -ge 1 && "${args[0]}" == "--" ]]; then
  args=("${args[@]:1}")
fi

has_direct_bundle_args=0
for arg in "${args[@]}"; do
  case "$arg" in
    -b|--bundles|--no-bundle|-h|--help)
      has_direct_bundle_args=1
      break
      ;;
  esac
done

if [[ "$has_direct_bundle_args" -eq 1 ]]; then
  exec "$repo_root/scripts/tauri.sh" build "${args[@]}"
fi

# Keep the default release path on the two bundle types that are stable in this
# repository today. RPM packaging stays out of the default flow until it is
# verified as reproducible again.
for bundle in deb appimage; do
  printf '[tauri:build] building %s\n' "$bundle"
  "$repo_root/scripts/tauri.sh" build "${args[@]}" --bundles "$bundle"
done
