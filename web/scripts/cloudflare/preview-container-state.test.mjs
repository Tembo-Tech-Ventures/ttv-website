import { describe, expect, it, vi } from 'vitest';
import { inspectPreviewContainer } from './preview-container-state.mjs';
const appId = 'a'.repeat(32);
const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '1', GITHUB_REF: 'refs/heads/sam/use-sam-mcp-tools-m8a3jp', STAGING_ACTION: 'preview-container-state', GITHUB_SHA: 'b'.repeat(40), STAGING_EXPECTED_SHA: 'b'.repeat(40), CLOUDFLARE_ACCOUNT_ID: 'c'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-token' };
const apps = { result: [{ id: appId, name: 'ttv-website-agent-pr-220-ffmpegcontainer', configuration: { secret: 'private-config' } }] };
const response = body => ({ ok: true, json: async () => body });
describe('one-shot preview container metadata', () => {
  it('only reads exact application and instances, emitting states without identifiers or secrets', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(apps)).mockResolvedValueOnce(response({ result: [{ id: 'private-instance', application_id: appId, status: { state: 'stopped', updated_at: '2026-10-25T13:00:00Z' } }] }));
    const result = await inspectPreviewContainer({ env, fetchImpl });
    expect(result).toMatchObject({ outcome: 'observed', count: 1, counts: { stopped: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain('?name=ttv-website-agent-pr-220-ffmpegcontainer&per_page=2');
    expect(fetchImpl.mock.calls[1][0]).toContain(`/${appId}/instances-v2?per_page=1000`);
    for (const [, options] of fetchImpl.mock.calls) expect(options).toMatchObject({ method: 'GET', redirect: 'error' });
    for (const value of [appId, env.CLOUDFLARE_ACCOUNT_ID, 'private-token', 'private-instance', 'private-config']) expect(JSON.stringify(result)).not.toContain(value);
  });
  it.each([{ GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_REF: 'refs/heads/main' }, { GITHUB_SHA: 'd'.repeat(40) }, { CLOUDFLARE_API_TOKEN: '' }])('refuses invalid execution before network: %j', async change => {
    const fetchImpl = vi.fn();
    expect((await inspectPreviewContainer({ env: { ...env, ...change }, fetchImpl })).outcome).toBe('telemetry-gap');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('does not retry permission denial or print the provider body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    expect(await inspectPreviewContainer({ env, fetchImpl })).toMatchObject({ outcome: 'telemetry-gap', reason: 'http-403' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([{ result: [] }, { result: [{ ...apps.result[0], name: 'other-app' }] }, { ...apps, result_info: { next_page_token: 'private-next' } }])('refuses absent/foreign/incomplete application resolution', async body => {
    const fetchImpl = vi.fn().mockResolvedValue(response(body));
    expect((await inspectPreviewContainer({ env, fetchImpl })).outcome).toBe('telemetry-gap');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('does not mistake incomplete instance pagination for shutdown', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(apps)).mockResolvedValueOnce(response({ result: [], result_info: { next_page_token: 'private-next' } }));
    expect(await inspectPreviewContainer({ env, fetchImpl })).toMatchObject({ outcome: 'telemetry-gap', reason: 'incomplete-instance-list' });
  });
  it('sanitizes thrown network errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('private-token private-url'));
    expect(await inspectPreviewContainer({ env, fetchImpl })).toMatchObject({ outcome: 'telemetry-gap', reason: 'request-or-response-failed' });
  });
});
