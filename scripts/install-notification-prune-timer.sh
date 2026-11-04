#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
install -d -m 700 "$unit_dir"
cat > "$unit_dir/lms-dtq-notification-prune.service" <<'UNIT'
[Unit]
Description=Prune old read LMS notifications
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec lms-dtq-app-1 npm run notifications:prune -- --apply
TimeoutStartSec=10min
UNIT
cat > "$unit_dir/lms-dtq-notification-prune.timer" <<'UNIT'
[Unit]
Description=Daily LMS notification cleanup

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now lms-dtq-notification-prune.timer
printf 'Installed daily notification cleanup timer.\n'
