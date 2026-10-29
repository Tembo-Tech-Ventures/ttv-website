import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedPrs, validateGateway, reclaim } from './one-shot-gateways.mjs';

test('only the twelve explicitly approved old closed-PR gateways are eligible', () => {
  assert.equal(approvedPrs.length, 12);
  const gateway = { id: 'ttv-website-ai-agent-pr-208', created_at: '2026-10-20 00:00:00', modified_at: '2026-10-20 00:00:00' };
  const now = Date.parse('2026-10-29T00:00:00Z');
  validateGateway(208, gateway, 'closed', now);
  for (const [pr, value, state] of [[208, gateway, 'open'], [234, gateway, 'closed'], [208, { ...gateway, id: 'ttv-website-ai-production' }, 'closed'], [208, { ...gateway, modified_at: '2026-10-28 00:00:00' }, 'closed'], [208, { ...gateway, created_at: 'invalid' }, 'closed']]) {
    assert.throws(() => validateGateway(pr, value, state, now));
  }
});

test('a later open PR prevents all deletions during preflight', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.includes('api.github.com')) return Response.json({ state: url.endsWith('/221') ? 'open' : 'closed' });
    return Response.json({ success: true, result: { id: url.split('/').at(-1), created_at: '2026-10-20 00:00:00', modified_at: '2026-10-20 00:00:00' } });
  };
  await assert.rejects(reclaim({ execute: true, fetcher, environment: { CLOUDFLARE_ACCOUNT_ID: 'test', CLOUDFLARE_API_TOKEN: 'test', GH_TOKEN: 'test' } }));
  assert.ok(calls.every(call => call.method !== 'DELETE'));
});
