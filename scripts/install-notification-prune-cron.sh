#!/usr/bin/env bash
# Installs a daily cron job that deletes read notifications older than 90 days.
# Cron starts each job with the account's current groups, so docker access
# granted after the systemd user manager started still applies. Replaces the
# older systemd timer (lms-dtq-notification-prune.timer) if it is enabled.
set -Eeuo pipefail
umask 077
[[ $(id -u) -ne 0 ]] || { echo 'Install as the account that runs Docker, not root.' >&2; exit 1; }
command -v crontab >/dev/null || { echo 'crontab is required.' >&2; exit 1; }
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
log_dir="$repo_dir/.deploy"
mkdir -p -- "$log_dir"
marker='# lms-dtq-notification-prune'
run="PATH=/usr/local/bin:/usr/bin:/bin docker exec lms-dtq-app-1 npm run --silent notifications:prune -- --apply >> '$log_dir/notification-prune.log' 2>&1"
# Daily at 00:07; also shortly after boot, so a day the server was off is caught up.
{
  crontab -l 2>/dev/null | grep -vF "$marker" || true
  printf '%s\n' "7 0 * * * $run $marker" "@reboot sleep 300 && $run $marker"
} | crontab -
if command -v systemctl >/dev/null && systemctl --user is-enabled lms-dtq-notification-prune.timer >/dev/null 2>&1; then
  systemctl --user disable --now lms-dtq-notification-prune.timer
  systemctl --user reset-failed lms-dtq-notification-prune.service 2>/dev/null || true
  printf 'Disabled the old systemd notification timer.\n'
fi
printf 'Installed daily notification cleanup cron job. Log: %s\n' "$log_dir/notification-prune.log"
