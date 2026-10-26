import { describe, expect, it, vi } from 'vitest';
import { verifyProbeBindings, verifyStagingProbeState } from './staging-probe-state.mjs';
const binding = (name, text) => ({ name, type: 'plain_text', text });
const demo = binding('STAGING_DEMO_ENABLED', 'true');
describe('live staging probe flags', () => {
  it.each([{ probe: [] }, { probe: [binding('STAGING_RETAINED_READ_PROBE_ENABLED', 'false')] }])('accepts disabled probe while preserving human demo', ({ probe }) => {
    expect(verifyProbeBindings([...probe, demo], { probeEnabled: false, demoEnabled: true })).toEqual({ probeEnabled: false, demoEnabled: true });
  });
  it.each([undefined, [demo, binding('STAGING_RETAINED_READ_PROBE_ENABLED', 'true')], [demo, { name: 'STAGING_RETAINED_READ_PROBE_ENABLED', type: 'secret_text' }], [demo, binding('STAGING_RETAINED_READ_PROBE_ENABLED', 'unknown')], [demo, binding('STAGING_RETAINED_READ_PROBE_ENABLED', 'false'), binding('STAGING_RETAINED_READ_PROBE_ENABLED', 'false')], []].map(bindings => ({ bindings })))('rejects unknown, active, duplicate or demo-off state', ({ bindings }) => {
    expect(() => verifyProbeBindings(bindings, { probeEnabled: false, demoEnabled: true })).toThrow('flag verification');
  });
  it('checks exact live staging identity before reading flags, with no writes', async () => {
    const verifyTarget = vi.fn(async () => {}), api = vi.fn(async () => ({ bindings: [demo] }));
    const environment = { CLOUDFLARE_ENVIRONMENT_NAME: 'staging', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), GITHUB_SHA: 'b'.repeat(40), CLOUDFLARE_STAGING_RETAINED_READ_PROBE_ENABLED: 'false', CLOUDFLARE_STAGING_DEMO_ENABLED: 'true' };
    expect(await verifyStagingProbeState({ environment, api, verifyTarget })).toEqual({ probeEnabled: false, demoEnabled: true, version: environment.GITHUB_SHA });
    expect(verifyTarget).toHaveBeenCalledWith(expect.objectContaining({ environmentName: 'staging', expectedVersion: environment.GITHUB_SHA }));
    expect(api).toHaveBeenCalledExactlyOnceWith('/workers/scripts/ttv-website-staging/settings');
  });
  it('does not read flags after identity verification fails', async () => {
    const api = vi.fn(), verifyTarget = vi.fn(async () => { throw new Error('identity mismatch'); });
    await expect(verifyStagingProbeState({ environment: { CLOUDFLARE_STAGING_RETAINED_READ_PROBE_ENABLED: 'false', CLOUDFLARE_STAGING_DEMO_ENABLED: 'true' }, api, verifyTarget })).rejects.toThrow('identity mismatch');
    expect(api).not.toHaveBeenCalled();
  });
});
