/** Isolated synthetic-data benchmark; execute inside the private validation app container. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const base = new URL(process.env.LMS_LOAD_BASE_URL || 'http://127.0.0.1:3000');
if (
  process.env.LMS_LOAD_TEST_DISPOSABLE !== 'true' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
)
  throw new Error(
    'Requires LMS_LOAD_TEST_DISPOSABLE=true and a loopback URL for a disposable database.',
  );
const bounded = (name, fallback, maximum) => {
  const value = Number(process.env[name] || fallback);
  assert(Number.isInteger(value) && value > 0 && value <= maximum, `${name} must be 1..${maximum}`);
  return value;
};
const classCount = bounded('LMS_LOAD_CLASSES', 10, 100);
const lessonsPerClass = bounded('LMS_LOAD_LESSONS', 10, 100);
const readCount = bounded('LMS_LOAD_READS', 200, 10000);
const writeCount = bounded('LMS_LOAD_WRITES', 50, 2000);
const concurrency = bounded('LMS_LOAD_CONCURRENCY', 10, 100);
const participants = {};
const createdClasses = [];
async function request(who, path, body) {
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: base.origin,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(participants[who] ? { Cookie: participants[who] } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${json.error || ''}`);
  return { response, json };
}
async function login(who, email, password) {
  const { response } = await request(who, '/api/auth/login', { email, password });
  participants[who] = response.headers.get('set-cookie').split(';')[0];
}
async function action(who, action, values = {}) {
  return (await request(who, '/api/actions', { action, ...values })).json.result;
}
async function sample(label, count, fn) {
  let next = 0;
  const durations = [];
  const failures = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, count) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= count) break;
        const before = performance.now();
        try {
          await fn(index);
        } catch (error) {
          failures.push(String(error.message));
        }
        durations.push(performance.now() - before);
      }
    }),
  );
  const elapsed = performance.now() - started;
  durations.sort((a, b) => a - b);
  const percentile = (p) =>
    Math.round(durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)]);
  return {
    label,
    requests: count,
    concurrency,
    failures: failures.length,
    errors: [...new Set(failures)],
    elapsedMs: Math.round(elapsed),
    requestsPerSecond: +((count * 1000) / elapsed).toFixed(1),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
  };
}
try {
  await login(
    'teacher',
    process.env.INTEGRATION_TEACHER_EMAIL || 'teacher@detuquy.vn',
    process.env.INTEGRATION_TEACHER_PASSWORD || 'Demo@2026',
  );
  await login(
    'student',
    process.env.INTEGRATION_STUDENT_EMAIL || 'student@detuquy.vn',
    process.env.INTEGRATION_STUDENT_PASSWORD || 'Demo@2026',
  );
  const teacherState = (await request('teacher', '/api/state')).json;
  assert.equal(teacherState.demo, false, 'Benchmark requires real PostgreSQL');
  let commentLesson;
  for (let i = 0; i < classCount; i++) {
    const classroom = await action('teacher', 'createClass', {
      title: `Synthetic benchmark ${Date.now()} ${i}`,
      autoApprove: true,
    });
    createdClasses.push(classroom);
    if (i === 0) await action('student', 'joinClass', { code: classroom.code });
    for (let j = 0; j < lessonsPerClass; j++) {
      const lesson = await action('teacher', 'saveLesson', {
        classId: classroom.id,
        title: `Synthetic lesson ${j}`,
        order: j + 1,
        description: 'Synthetic benchmark data. '.repeat(100),
        published: true,
      });
      if (i === 0 && j === 0) commentLesson = lesson.id;
    }
  }
  // Warm the route and connection pool before timing.
  await Promise.all([request('teacher', '/api/state'), request('student', '/api/state')]);
  const reads = await sample('scoped state reads', readCount, (index) =>
    request(index % 2 ? 'teacher' : 'student', '/api/state'),
  );
  const writes = await sample('discussion writes with locked snapshots', writeCount, (index) =>
    action('student', 'comment', {
      lessonId: commentLesson,
      content: `Synthetic concurrent comment ${index}`,
    }),
  );
  console.log(
    JSON.stringify(
      {
        database: 'PostgreSQL',
        syntheticClasses: classCount,
        syntheticLessons: classCount * lessonsPerClass,
        authenticatedUsers: 2,
        reads,
        writes,
      },
      null,
      2,
    ),
  );
  if (reads.failures || writes.failures) process.exitCode = 1;
} finally {
  for (const classroom of createdClasses.reverse()) {
    try {
      const state = (await request('teacher', '/api/state')).json;
      const current = state.classes.find((c) => c.id === classroom.id);
      if (current)
        await action('teacher', 'deleteClass', {
          classId: current.id,
          code: current.code,
          expectedRevision: current.revision || '',
        });
    } catch (error) {
      console.error(`Synthetic class cleanup failed (${classroom.id}): ${error.message}`);
      process.exitCode = 1;
    }
  }
}
