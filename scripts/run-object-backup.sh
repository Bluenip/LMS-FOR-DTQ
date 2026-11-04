#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/lms-dtq-object-backup"
config_file="$config_dir/config"
[[ -f "$config_file" && ! -L "$config_file" ]] || { printf 'Missing private object backup config.\n' >&2; exit 1; }
owner="$(stat -c '%u' "$config_file")"
mode="$(stat -c '%a' "$config_file")"
[[ "$owner" == "$(id -u)" && "$mode" =~ ^[0-7]{3,4}$ && $((8#$mode & 077)) -eq 0 ]] || { printf 'Object backup config must be owned by this user and inaccessible to group/others.\n' >&2; exit 1; }
set -a
# This is a shell config owned exclusively by the backup operator.
source "$config_file"
set +a
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_dir"
exec node scripts/backup-objects.mjs
