import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';

const script = resolve('scripts/auto-deploy.sh');
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lms-deploy-test-'));
  const upstream = join(root, 'upstream');
  const remote = join(root, 'origin.git');
  const repo = join(root, 'server');
  const bin = join(root, 'bin');
  const log = join(root, 'docker.log');
  await mkdir(upstream);
  await mkdir(bin);
  git(root, 'init', '--bare', remote);
  git(upstream, 'init', '-b', 'main');
  git(upstream, 'config', 'user.name', 'Deployment Test');
  git(upstream, 'config', 'user.email', 'deployment@example.invalid');
  await writeFile(join(upstream, '.gitignore'), '.deploy/\n.env.production\n');
  await writeFile(join(upstream, 'compose.production.yml'), 'services: {}\n');
  await writeFile(join(upstream, 'revision.txt'), 'initial\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-m', 'Initial fixture');
  git(upstream, 'remote', 'add', 'origin', remote);
  git(upstream, 'push', '-u', 'origin', 'main');
  git(root, 'clone', '--branch', 'main', remote, repo);
  await writeFile(join(repo, '.env.production'), 'PRIVATE_CONFIG=preserve-me\n');
  await writeFile(log, '');
  await writeFile(
    join(bin, 'docker'),
    `#!/usr/bin/env bash
printf '%s %s\\n' "\${LMS_IMAGE:-none}" "$*" >> "$DOCKER_TEST_LOG"
if [[ "$*" == *"build app"* && -f "$DOCKER_FAIL_BUILD" ]]; then exit 7; fi
if [[ "$*" == *"up -d --wait --wait-timeout 180"* && -f "$DOCKER_FAIL_ROLLOUT" ]]; then exit 8; fi
if [[ "$*" == *"pg_dump"* ]]; then printf PGDMPfixture; fi
exit 0
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LMS_REPO_DIR: repo,
    DOCKER_TEST_LOG: log,
    DOCKER_FAIL_BUILD: join(root, 'fail-build'),
    DOCKER_FAIL_ROLLOUT: join(root, 'fail-rollout'),
  };
  const run = (mode = '--once') => spawnSync('bash', [script, mode], { env, encoding: 'utf8' });
  const active = () => readFile(join(repo, '.deploy', 'active'), 'utf8');
  const update = async (value: string) => {
    await writeFile(join(upstream, 'revision.txt'), value);
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-m', `Revision ${value}`);
    git(upstream, 'push', 'origin', 'main');
    return git(upstream, 'rev-parse', 'HEAD');
  };
  return {
    root,
    upstream,
    repo,
    bin,
    log,
    env,
    run,
    active,
    update,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('auto deployment applies new revisions, keeps configuration and skips unchanged GitHub commits', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    const revision = await f.update('next');
    assert.equal(f.run().status, 0);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), revision);
    assert((await f.active()).startsWith(revision));
    assert.equal(
      await readFile(join(f.repo, '.env.production'), 'utf8'),
      'PRIVATE_CONFIG=preserve-me\n',
    );
    const before = await readFile(f.log, 'utf8');
    assert.equal(f.run().status, 0);
    assert.equal(await readFile(f.log, 'utf8'), before);
    const backups = await readdir(join(f.repo, '.deploy', 'backups'));
    assert.equal(backups.length, 2);
    assert.equal(
      await readFile(join(f.repo, '.deploy', 'backups', backups[0]), 'utf8'),
      'PGDMPfixture',
    );
  } finally {
    await f.cleanup();
  }
});
test('a failed build preserves the deployed revision and postpones automatic retries', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    const active = await f.active();
    await f.update('broken-build');
    await writeFile(f.env.DOCKER_FAIL_BUILD, '');
    assert.equal(f.run().status, 7);
    assert.equal(await f.active(), active);
    const before = await readFile(f.log, 'utf8');
    assert.equal(f.run().status, 0);
    assert.equal(await readFile(f.log, 'utf8'), before);
    await rm(f.env.DOCKER_FAIL_BUILD);
    assert.equal(f.run('--force').status, 0);
    assert.notEqual(await f.active(), active);
  } finally {
    await f.cleanup();
  }
});
test('an update can replace the running deployment script without interrupting the current run', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.upstream, 'scripts'));
    await writeFile(join(f.upstream, 'scripts/auto-deploy.sh'), await readFile(script));
    await f.update('install-updater');
    assert.equal(f.run().status, 0);
    await writeFile(
      join(f.upstream, 'scripts/auto-deploy.sh'),
      '#!/usr/bin/env bash\n# A replacement is used only on the following run.\nexit 23\n',
    );
    const revision = await f.update('replace-updater');
    const result = spawnSync('bash', [join(f.repo, 'scripts/auto-deploy.sh'), '--once'], {
      env: f.env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert((await f.active()).startsWith(revision));
    assert(!(await readdir(join(f.repo, '.deploy'))).some((name) => name.startsWith('run-')));
    assert.equal(
      spawnSync('bash', [join(f.repo, 'scripts/auto-deploy.sh')], { env: f.env }).status,
      23,
    );
  } finally {
    await f.cleanup();
  }
});
test('a failed rollout restores the previous app image and leaves its active state intact', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    const active = await f.active();
    const image = active.trim().split(' ')[1];
    await f.update('bad-health');
    await writeFile(f.env.DOCKER_FAIL_ROLLOUT, '');
    assert.equal(f.run().status, 8);
    assert.equal(await f.active(), active);
    assert((await readFile(f.log, 'utf8')).includes(`${image} compose --project-name lms-dtq`));
    assert(
      (await readFile(f.log, 'utf8')).includes('up -d --no-deps --wait --wait-timeout 120 app'),
    );
  } finally {
    await f.cleanup();
  }
});
test('local edits are never discarded by the updater', async () => {
  const f = await fixture();
  try {
    await f.update('upstream-change');
    await writeFile(join(f.repo, 'revision.txt'), 'uncommitted operator edit');
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /local edits/);
    assert.equal(await readFile(join(f.repo, 'revision.txt'), 'utf8'), 'uncommitted operator edit');
    assert.equal(await readFile(f.log, 'utf8'), '');
  } finally {
    await f.cleanup();
  }
});
test('the updater refuses divergent Git history without resetting operator commits', async () => {
  const f = await fixture();
  try {
    git(f.repo, 'config', 'user.name', 'Server Operator');
    git(f.repo, 'config', 'user.email', 'operator@example.invalid');
    await writeFile(join(f.repo, 'operator.txt'), 'keep');
    git(f.repo, 'add', '.');
    git(f.repo, 'commit', '-m', 'Operator change');
    const before = git(f.repo, 'rev-parse', 'HEAD');
    await f.update('remote-change');
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /histories diverged/);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), before);
  } finally {
    await f.cleanup();
  }
});
test('automatic deployment retains only three managed database backups', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5; i++) {
      await f.update(`release-${i}`);
      assert.equal(f.run().status, 0);
    }
    const files = await readdir(join(f.repo, '.deploy', 'backups'));
    assert.equal(files.length, 3);
    assert(files.every((name) => name.startsWith('deploy-') && name.endsWith('.dump')));
  } finally {
    await f.cleanup();
  }
});
test('an overlapping deployment exits without issuing Docker commands', async () => {
  const f = await fixture();
  let lock: ReturnType<typeof spawn> | undefined;
  try {
    await mkdir(join(f.repo, '.deploy'));
    lock = spawn(
      'flock',
      ['-x', join(f.repo, '.deploy', 'update.lock'), 'bash', '-c', 'echo ready; read -r line'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    await once(lock.stdout!, 'data');
    const result = f.run();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Another deployment/);
    assert.equal(await readFile(f.log, 'utf8'), '');
    lock.stdin!.end('done\n');
    await once(lock, 'exit');
    lock = undefined;
  } finally {
    lock?.kill();
    await f.cleanup();
  }
});
test('installing the user timer enables boot startup and periodic checks without sudo', async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.bin, 'loginctl'),
      '#!/usr/bin/env bash\nif [[ "$1" == show-user ]]; then echo yes; fi\n',
      { mode: 0o755 },
    );
    await writeFile(
      join(f.bin, 'systemctl'),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$DOCKER_TEST_LOG"\n',
      { mode: 0o755 },
    );
    const config = join(f.root, 'config');
    const result = spawnSync('bash', [script, '--install-systemd'], {
      env: { ...f.env, XDG_CONFIG_HOME: config },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const timer = await readFile(join(config, 'systemd/user/lms-dtq-update.timer'), 'utf8');
    assert.match(timer, /OnStartupSec=45s/);
    assert.match(timer, /OnUnitInactiveSec=60s/);
    assert.match(timer, /WantedBy=timers.target/);
    assert((await readFile(f.log, 'utf8')).includes('enable --now lms-dtq-update.timer'));
  } finally {
    await f.cleanup();
  }
});
