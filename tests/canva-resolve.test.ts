import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCanvaShortLink } from '../src/lib/server/canva';

/** A fake fetch that answers each URL with a redirect (or status) from the table. */
function fakeFetch(table: Record<string, { status: number; location?: string } | Error>) {
  const calls: { url: string; redirect?: RequestRedirect }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, redirect: init?.redirect });
    const answer = table[url];
    if (!answer) throw new Error(`unexpected ${url}`);
    if (answer instanceof Error) throw answer;
    return new Response(null, {
      status: answer.status,
      headers: answer.location ? { location: answer.location } : {},
    });
  }) as typeof fetch;
  return { fetcher, calls };
}

test('a canva.link short link resolves to the read-only embed of its design', async () => {
  const { fetcher, calls } = fakeFetch({
    'https://canva.link/abc123': {
      status: 301,
      location:
        'https://www.canva.com/design/DAHbg4agcmc/CqZvjzNeZA48O_xmFmM84w/edit?utm_source=sharebutton',
    },
  });
  assert.equal(
    await resolveCanvaShortLink('https://canva.link/abc123', fetcher),
    'https://www.canva.com/design/DAHbg4agcmc/CqZvjzNeZA48O_xmFmM84w/view?embed',
  );
  assert.equal(calls[0].redirect, 'manual', 'the redirect is read, never followed');
  // Cached: no second request.
  await resolveCanvaShortLink('https://canva.link/abc123/', fetcher);
  assert.equal(calls.length, 1);
});

test('short links that do not lead to a design give null; chains are followed on canva.link only', async () => {
  const { fetcher, calls } = fakeFetch({
    'https://canva.link/chain1': { status: 302, location: 'https://canva.link/chain2' },
    'https://canva.link/chain2': {
      status: 302,
      location: 'https://www.canva.com/design/DAF1/tok/view',
    },
    'https://canva.link/away': { status: 301, location: 'https://evil.example/design/DAF1/t/view' },
    'https://canva.link/gone': { status: 404 },
  });
  assert.equal(
    await resolveCanvaShortLink('https://canva.link/chain1', fetcher),
    'https://www.canva.com/design/DAF1/tok/view?embed',
  );
  assert.equal(await resolveCanvaShortLink('https://canva.link/away', fetcher), null);
  assert.equal(await resolveCanvaShortLink('https://canva.link/gone', fetcher), null);
  assert.ok(!calls.some((c) => c.url.startsWith('https://evil.example')));
  // Not a short link: nothing is fetched.
  const before = calls.length;
  assert.equal(await resolveCanvaShortLink('https://example.com/abc', fetcher), null);
  assert.equal(calls.length, before);
});

test('a network failure is reported, not cached', async () => {
  const failing = fakeFetch({ 'https://canva.link/flaky': new Error('offline') });
  await assert.rejects(resolveCanvaShortLink('https://canva.link/flaky', failing.fetcher));
  const working = fakeFetch({
    'https://canva.link/flaky': {
      status: 301,
      location: 'https://www.canva.com/design/DAF2/tok/view',
    },
  });
  assert.equal(
    await resolveCanvaShortLink('https://canva.link/flaky', working.fetcher),
    'https://www.canva.com/design/DAF2/tok/view?embed',
  );
});
