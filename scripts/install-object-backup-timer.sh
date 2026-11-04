#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
backup_script="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/run-object-backup.sh"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
[[ "$backup_script" != *$'\n'* && "$backup_script" != *'"'* && "$backup_script" != *'%'* ]] || { printf 'Unsupported script path.\n' >&2; exit 1; }
install -d -m 700 "$unit_dir"
cat > "$unit_dir/lms-dtq-object-backup.service" <<UNIT
[Unit]
Description=Backup and verify LMS object storage
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash "$backup_script"
TimeoutStartSec=23h
UMask=0077
UNIT
cat > "$unit_dir/lms-dtq-object-backup.timer" <<'UNIT'
[Unit]
Description=Daily verified LMS object backup

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now lms-dtq-object-backup.timer
printf 'Installed object backup timer.\n'
