#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Bound the entire pipeline (including SSH, encryption and verification), not just connect.
if [[ ${LMS_BACKUP_BOUNDED:-0} != 1 ]]; then
  export LMS_BACKUP_BOUNDED=1
  exec timeout --signal=TERM --kill-after=15s "${LMS_BACKUP_TIMEOUT_SECONDS:-600}" /bin/bash "${BASH_SOURCE[0]}" "$@"
fi

backup_mount="${LMS_BACKUP_MOUNT:-/mnt/BACKUP}"
backup_dir="${LMS_BACKUP_DIR:-$backup_mount/LMS-backups}"
backup_config_dir="${LMS_BACKUP_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/lms-dtq-backup}"
backup_key="$backup_config_dir/encryption-key"
backup_host="${LMS_BACKUP_HOST:-}"
if [[ -z "$backup_host" && -f "$backup_config_dir/host" ]]; then
  IFS= read -r backup_host < "$backup_config_dir/host" || true
fi
[[ "$backup_host" =~ ^[a-zA-Z0-9._-]+@[a-zA-Z0-9._:-]+$ ]] || { printf 'Set LMS_BACKUP_HOST to the SSH user and host.\n' >&2; exit 1; }

for tool in ssh gpg openssl flock findmnt timeout; do
  command -v "$tool" >/dev/null || { printf 'Missing required command: %s\n' "$tool" >&2; exit 1; }
done
if [[ "${LMS_BACKUP_SKIP_MOUNT_CHECK:-false}" != true ]]; then
  findmnt --mountpoint "$backup_mount" >/dev/null || { printf 'Backup disk is not mounted: %s\n' "$backup_mount" >&2; exit 1; }
fi
install -d -m 700 "$backup_dir" "$backup_config_dir"
exec 9>"$backup_config_dir/backup.lock"
flock -n 9 || { printf 'Another backup is running.\n' >&2; exit 1; }
if [[ ! -s "$backup_key" ]]; then
  if compgen -G "$backup_dir/lms-*.dump.gpg" >/dev/null; then
    printf 'Encryption key missing while backups exist; refusing to replace it.\n' >&2
    exit 1
  fi
  openssl rand -base64 48 > "$backup_key"
fi
chmod 600 "$backup_key"
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_target="$backup_dir/lms-$backup_stamp-$$.dump.gpg"
backup_temp="$(mktemp "$backup_dir/.lms-backup-XXXXXX")"
trap 'status=$?; rm -f -- "$backup_temp"; if (( status != 0 )); then printf "ERROR: LMS backup failed (status %s); previous backups retained.\\n" "$status" >&2; fi' EXIT
# Bash otherwise exits on TERM without reliably executing the EXIT cleanup when
# timeout interrupts the pipeline.
trap 'exit 143' TERM HUP INT
ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 "$backup_host" \
  'timeout --kill-after=10s 480 docker exec lms-dtq-postgres-1 pg_dump -U lms -d lms -Fc' |
  gpg --batch --yes --pinentry-mode loopback --passphrase-file "$backup_key" \
    --symmetric --cipher-algo AES256 --output "$backup_temp"
# Verify both decryption and the PostgreSQL archive table of contents without restoring production.
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$backup_key" --decrypt "$backup_temp" |
  ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 "$backup_host" \
    'timeout --kill-after=10s 120 docker exec -i lms-dtq-postgres-1 pg_restore --list >/dev/null'
mv -- "$backup_temp" "$backup_target"
trap - EXIT
printf 'Encrypted database backup verified: %s\n' "$backup_target"
