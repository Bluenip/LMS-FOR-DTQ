#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
backup_script="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/pull-production-backup.sh"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
[[ "$backup_script" != *$'\n'* && "$backup_script" != *'"'* ]] || { printf 'Unsupported script path.\n' >&2; exit 1; }
install -d -m 700 "$unit_dir"
cat > "$unit_dir/lms-dtq-backup.service" <<UNIT
[Unit]
Description=Encrypted LMS database backup to the local backup disk
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash "$backup_script"
UNIT
cat > "$unit_dir/lms-dtq-backup.timer" <<'UNIT'
[Unit]
Description=Daily encrypted LMS database backup

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now lms-dtq-backup.timer
printf 'Installed daily user backup timer.\n'
