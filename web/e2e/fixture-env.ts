/**
 * Fixture data (amina/kwame profiles, client projects) is seeded only into
 * isolated agent-* environments. Suites that assert on fixtures — or that
 * write rows a real environment must never receive — skip everywhere else
 * (production, shared staging, local dev servers).
 */
export const FIXTURE_ENVIRONMENT = /^agent-/.test(
  process.env.EXPECTED_DEPLOYMENT_ENVIRONMENT ?? ""
);
