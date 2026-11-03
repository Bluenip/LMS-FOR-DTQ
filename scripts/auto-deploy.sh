#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=${LMS_REPO_DIR:-$(cd -- "$script_dir/.." && pwd)}
branch=${LMS_BRANCH:-main}
state_dir=${LMS_STATE_DIR:-$repo_dir/.deploy}
env_file=${LMS_ENV_FILE:-$repo_dir/.env.production}
mode=${1:---once}

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# Git may replace this script during the update. Execute a private snapshot so
# Bash never continues reading a file that has changed beneath it.
if [[ "$mode" != --install-systemd && ${LMS_DEPLOY_SNAPSHOT:-0} != 1 ]]; then
  mkdir -p -- "$state_dir"
  run_copy=$(mktemp "$state_dir/run-XXXXXXXX.sh")
  cp -- "${BASH_SOURCE[0]}" "$run_copy"
  run_status=0
  LMS_DEPLOY_SNAPSHOT=1 LMS_REPO_DIR="$repo_dir" /bin/bash "$run_copy" "$@" || run_status=$?
  rm -f -- "$run_copy"
  exit "$run_status"
fi

if [[ "$mode" == --install-systemd ]]; then
  [[ $(id -u) -ne 0 ]] || die 'Install the user timer as the account that owns the repository.'
  command -v loginctl >/dev/null || die 'loginctl is required for startup at boot.'
  loginctl enable-linger "$(id -un)"
  [[ $(loginctl show-user "$(id -un)" -p Linger --value) == yes ]] || die 'User lingering is not enabled.'
  unit_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
  mkdir -p -- "$unit_dir"
  cat > "$unit_dir/lms-dtq-update.service" <<EOF
[Unit]
Description=Fetch and deploy LMS updates from GitHub
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$repo_dir
Environment="LMS_REPO_DIR=$repo_dir"
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
ExecStart=/bin/bash "$repo_dir/scripts/auto-deploy.sh" --once
TimeoutStartSec=15min
UMask=0077
EOF
  cat > "$unit_dir/lms-dtq-update.timer" <<'EOF'
[Unit]
Description=Check LMS updates after startup and every minute

[Timer]
OnStartupSec=45s
OnUnitInactiveSec=60s
RandomizedDelaySec=10s
AccuracySec=1s
Unit=lms-dtq-update.service

[Install]
WantedBy=timers.target
EOF
  chmod 644 "$unit_dir/lms-dtq-update.service" "$unit_dir/lms-dtq-update.timer"
  systemctl --user daemon-reload
  systemctl --user enable --now lms-dtq-update.timer
  log 'Update timer enabled; user lingering starts it at boot without an SSH login.'
  exit 0
fi

[[ "$mode" == --once || "$mode" == --force ]] || die 'Usage: auto-deploy.sh [--once|--force|--install-systemd]'
for program in git docker flock timeout; do
  command -v "$program" >/dev/null || die "$program is required."
done
[[ -f "$env_file" ]] || die "Missing environment file: $env_file"
[[ -f "$repo_dir/compose.production.yml" ]] || die 'Production Compose file is missing.'
mkdir -p -- "$state_dir/backups"
exec 9> "$state_dir/update.lock"
if ! flock -n 9; then log 'Another deployment is running; skipped.'; exit 0; fi

git -C "$repo_dir" rev-parse --is-inside-work-tree >/dev/null
[[ $(git -C "$repo_dir" symbolic-ref --short HEAD) == "$branch" ]] || die "Check out branch $branch before deploying."
[[ -z $(git -C "$repo_dir" status --porcelain) ]] || die 'Repository has local edits; refusing to overwrite them.'
export GIT_TERMINAL_PROMPT=0
timeout 120 git -C "$repo_dir" fetch --prune origin
target=$(git -C "$repo_dir" rev-parse "refs/remotes/origin/$branch")
[[ "$target" =~ ^[0-9a-f]{40}$ ]] || die 'Invalid remote revision.'
previous_commit=''
previous_image=''
[[ ! -f "$state_dir/active" ]] || read -r previous_commit previous_image < "$state_dir/active"
if [[ "$mode" != --force && "$previous_commit" == "$target" ]]; then
  log "Already deployed ${target:0:12}; no changes."
  exit 0
fi
if [[ "$mode" != --force && -f "$state_dir/failed" ]]; then
  read -r failed_commit failed_at < "$state_dir/failed"
  if [[ "$failed_commit" == "$target" && "$failed_at" =~ ^[0-9]+$ ]] &&
    (( $(date +%s) - failed_at < ${LMS_RETRY_SECONDS:-300} )); then
    log 'Recent attempt failed; retry postponed for five minutes.'
    exit 0
  fi
fi
git -C "$repo_dir" merge-base --is-ancestor HEAD "$target" || die 'Local and remote histories diverged; no reset performed.'
git -C "$repo_dir" merge --ff-only --no-edit "$target"
image="${LMS_IMAGE_PREFIX:-lms-dtq}:${target:0:12}"
rollout_started=false

compose() {
  LMS_IMAGE="$image" docker compose --project-name lms-dtq --env-file "$env_file" \
    -f "$repo_dir/compose.production.yml" "$@"
}
failed() {
  status=$?
  trap - ERR
  printf '%s %s\n' "$target" "$(date +%s)" > "$state_dir/failed"
  log "Deployment failed for ${target:0:12}; see the service journal."
  if [[ "$rollout_started" == true && -n "$previous_image" ]]; then
    image=$previous_image
    log "Restoring previous application image: $image"
    if ! compose up -d --no-deps --wait --wait-timeout 120 app; then
      log 'Application rollback failed. Database backup is retained for recovery.'
    fi
  fi
  exit "$status"
}
trap failed ERR
docker info >/dev/null
compose config --quiet
log "Building revision ${target:0:12}; running application remains active during the build."
compose build app
compose up -d --wait --wait-timeout 120 postgres
backup="$state_dir/backups/deploy-$(date -u +%Y%m%dT%H%M%S)-${target:0:12}-$$.dump"
compose exec -T postgres pg_dump -U lms -d lms -Fc > "$backup.tmp"
mv -- "$backup.tmp" "$backup"
rollout_started=true
compose up -d --wait --wait-timeout 180
printf '%s %s\n' "$target" "$image" > "$state_dir/active.tmp"
mv -- "$state_dir/active.tmp" "$state_dir/active"
rm -f -- "$state_dir/failed"
trap - ERR

# Retain only this script's three most recent database backups.
mapfile -t old_backups < <(find "$state_dir/backups" -maxdepth 1 -type f -name 'deploy-*.dump' -print | sort -r | tail -n +4)
if ((${#old_backups[@]})); then rm -- "${old_backups[@]}"; fi
if managed_images=$(docker image ls --format '{{.Repository}}:{{.Tag}}'); then
  while IFS= read -r candidate; do
    if [[ "${candidate%:*}" == "${LMS_IMAGE_PREFIX:-lms-dtq}" && "$candidate" =~ :[0-9a-f]{12}$ &&
      "$candidate" != "$image" && "$candidate" != "$previous_image" ]]; then
      docker image rm "$candidate" >/dev/null 2>&1 || log "Image still in use; retained $candidate"
    fi
  done <<< "$managed_images"
fi
log "Deployed ${target:0:12}; app is healthy, database backup retained."
