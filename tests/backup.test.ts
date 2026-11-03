import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const backupScript = resolve('scripts/pull-production-backup.sh');
const timerScript = resolve('scripts/install-backup-timer.sh');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lms-backup-test-'));
  const bin = join(root, 'bin');
  const backup = join(root, 'backups');
  const config = join(root, 'config');
  await Promise.all([mkdir(bin), mkdir(backup), mkdir(config)]);
  await writeFile(join(config, 'encryption-key'), 'fixture-key-not-a-real-secret\n', {
    mode: 0o600,
  });
  await writeFile(join(backup, 'lms-previous.dump.gpg'), 'previous-backup');
  const stub = (name: string, body: string) =>
    writeFile(join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
      mode: 0o755,
    });
  await stub(
    'ssh',
    `
printf '%s\\n' "$*" >> "$BACKUP_TEST_LOG"
if [[ "$*" == *pg_dump* ]]; then
  if [[ "\${BACKUP_TEST_MODE:-}" == timeout ]]; then sleep 30; fi
  printf PGDMPfixture
  if [[ "\${BACKUP_TEST_MODE:-}" == dump-failure ]]; then exit 7; fi
else
  data=$(cat)
  [[ "$data" == PGDMPfixture ]]
  if [[ "\${BACKUP_TEST_MODE:-}" == verify-failure ]]; then exit 8; fi
fi`,
  );
  await stub(
    'gpg',
    `
output=''
decrypt=''
while (($#)); do
  case "$1" in
    --output) output=$2; shift 2;;
    --decrypt) decrypt=$2; shift 2;;
    *) shift;;
  esac
done
if [[ -n "$decrypt" ]]; then
  if [[ "\${BACKUP_TEST_MODE:-}" == decrypt-failure ]]; then exit 9; fi
  cat "$decrypt"
else
  cat > "$output"
fi`,
  );
  await stub('systemctl', 'printf "%s\\n" "$*" >> "$BACKUP_TEST_LOG"');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LMS_BACKUP_DIR: backup,
    LMS_BACKUP_CONFIG_DIR: config,
    LMS_BACKUP_HOST: 'test@host.invalid',
    LMS_BACKUP_SKIP_MOUNT_CHECK: 'true',
    LMS_BACKUP_TIMEOUT_SECONDS: '3',
    LMS_BACKUP_BOUNDED: '0',
    BACKUP_TEST_LOG: join(root, 'commands'),
  };
  const run = (extra = {}) =>
    spawnSync('bash', [backupScript], {
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 6000,
    });
  const unchanged = async () => {
    assert.equal(await readFile(join(backup, 'lms-previous.dump.gpg'), 'utf8'), 'previous-backup');
    assert.equal(
      await readFile(join(config, 'encryption-key'), 'utf8'),
      'fixture-key-not-a-real-secret\n',
    );
    assert(!(await readdir(backup)).some((name) => name.startsWith('.lms-backup-')));
    assert.equal(
      spawnSync('flock', ['-n', join(config, 'backup.lock'), 'true']).status,
      0,
      'backup lock released',
    );
  };
  return {
    root,
    bin,
    backup,
    config,
    env,
    run,
    unchanged,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('backup publishes only verified archives and preserves existing backups and encryption key', async () => {
  const f = await fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    await f.unchanged();
    const archives = (await readdir(f.backup)).filter((name) => name !== 'lms-previous.dump.gpg');
    assert.equal(archives.length, 1);
    assert.equal(await readFile(join(f.backup, archives[0]), 'utf8'), 'PGDMPfixture');
    assert.equal((await stat(join(f.backup, archives[0]))).mode & 0o777, 0o600);
    const log = await readFile(f.env.BACKUP_TEST_LOG, 'utf8');
    assert.match(log, /BatchMode=yes/);
    assert.match(log, /ServerAliveCountMax=2/);
    assert.match(log, /timeout --kill-after=10s 480.*pg_dump/);
    assert.match(log, /timeout --kill-after=10s 120.*pg_restore --list/);
  } finally {
    await f.cleanup();
  }
});
for (const mode of ['dump-failure', 'decrypt-failure', 'verify-failure'])
  test(`backup ${mode} removes partial data, preserves original archives, and releases lock`, async () => {
    const f = await fixture();
    try {
      const result = f.run({ BACKUP_TEST_MODE: mode });
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /backup failed/);
      assert.deepEqual(await readdir(f.backup), ['lms-previous.dump.gpg']);
      await f.unchanged();
      assert.equal(f.run().status, 0, 'next backup can proceed after failure');
    } finally {
      await f.cleanup();
    }
  });
test('total backup timeout terminates hung pipelines, removes temporary files and releases lock', async () => {
  const f = await fixture();
  try {
    const started = Date.now();
    const result = f.run({ BACKUP_TEST_MODE: 'timeout', LMS_BACKUP_TIMEOUT_SECONDS: '0.25' });
    assert.equal(result.status, 124, result.stdout + result.stderr);
    assert(Date.now() - started < 4000);
    assert.deepEqual(await readdir(f.backup), ['lms-previous.dump.gpg']);
    await f.unchanged();
    assert.equal(f.run().status, 0, 'next backup can proceed after interruption');
  } finally {
    await f.cleanup();
  }
});
test('backup never replaces encryption key when existing archives need the missing key', async () => {
  const f = await fixture();
  try {
    await rm(join(f.config, 'encryption-key'));
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to replace/);
    assert.deepEqual(await readdir(f.backup), ['lms-previous.dump.gpg']);
    assert(!(await readdir(f.config)).includes('encryption-key'));
  } finally {
    await f.cleanup();
  }
});
test('two runs with the same timestamp retain separate verified backup archives', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.bin, 'date'), '#!/usr/bin/env bash\nprintf "20261103T000000Z\\n"\n', {
      mode: 0o755,
    });
    assert.equal(f.run().status, 0);
    assert.equal(f.run().status, 0);
    assert.equal(
      (await readdir(f.backup)).filter((name) => name.startsWith('lms-20261103')).length,
      2,
    );
    await f.unchanged();
  } finally {
    await f.cleanup();
  }
});
test('backup timer applies a service deadline and kills the full process group', async () => {
  const f = await fixture();
  try {
    const result = spawnSync('bash', [timerScript], {
      env: { ...f.env, XDG_CONFIG_HOME: f.config },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const service = await readFile(join(f.config, 'systemd/user/lms-dtq-backup.service'), 'utf8');
    assert.match(service, /TimeoutStartSec=11min/);
    assert.match(service, /KillMode=control-group/);
    assert.match(service, /UMask=0077/);
    const timer = await readFile(join(f.config, 'systemd/user/lms-dtq-backup.timer'), 'utf8');
    assert.match(timer, /OnCalendar=daily/);
    assert.match(timer, /Persistent=true/);
    assert.match(
      await readFile(f.env.BACKUP_TEST_LOG, 'utf8'),
      /enable --now lms-dtq-backup.timer/,
    );
  } finally {
    await f.cleanup();
  }
});
