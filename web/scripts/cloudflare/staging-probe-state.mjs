import { pathToFileURL } from 'node:url';
import { cfApi } from './lib.mjs';
import { verifyStagingFixtureTarget, STAGING_FIXTURE_ORIGIN } from './staging-fixture-target.mjs';

export function verifyProbeBindings(bindings, { probeEnabled, demoEnabled }) {
  if (!Array.isArray(bindings)) throw new Error('Staging flag verification failed.');
  function enabled(name) {
    const values = bindings.filter(binding => binding.name === name);
    if (values.length === 0) return false;
    if (values.length !== 1 || values[0].type !== 'plain_text' || !['true', 'false'].includes(values[0].text)) {
      throw new Error('Staging flag verification failed.');
    }
    return values[0].text === 'true';
  }
  if (enabled('STAGING_RETAINED_READ_PROBE_ENABLED') !== probeEnabled || enabled('STAGING_DEMO_ENABLED') !== demoEnabled) {
    throw new Error('Staging flag verification failed.');
  }
  return { probeEnabled, demoEnabled };
}

export async function verifyStagingProbeState({ environment = process.env, api = cfApi, verifyTarget = verifyStagingFixtureTarget } = {}) {
  const probe = environment.CLOUDFLARE_STAGING_RETAINED_READ_PROBE_ENABLED;
  const demo = environment.CLOUDFLARE_STAGING_DEMO_ENABLED;
  if (![probe, demo].every(value => ['true', 'false'].includes(value))) throw new Error('Explicit staging flag expectations required.');
  await verifyTarget({ environmentName: environment.CLOUDFLARE_ENVIRONMENT_NAME, accountId: environment.CLOUDFLARE_ACCOUNT_ID,
    expectedVersion: environment.GITHUB_SHA, baseUrl: STAGING_FIXTURE_ORIGIN, api });
  const settings = await api('/workers/scripts/ttv-website-staging/settings');
  return { ...verifyProbeBindings(settings?.bindings, { probeEnabled: probe === 'true', demoEnabled: demo === 'true' }), version: environment.GITHUB_SHA };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify({ event: 'staging-probe-state', verified: true, ...await verifyStagingProbeState() })); }
  catch { console.error('Staging probe flag verification failed.'); process.exitCode = 1; }
}
