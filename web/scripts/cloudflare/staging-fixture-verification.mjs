import { verifyBrowserDiscovery } from "./staging-browser-discovery.mjs";
import { audienceRoutesPresent, verifyAudienceAccess } from "./staging-audience-verification.mjs";
import { COMMUNITY_EVIDENCE_DIRECTORY, verifyStagingCommunityJourney } from "./staging-community-journey.mjs";

/** Fixed verification program. Do not accept arbitrary scripts, roles or target IDs from workflow input. */
export async function verifyStagingPersonas({ browser, target, personas, verifyJourney = verifyStagingCommunityJourney, verifyAudience = verifyAudienceAccess, audienceEnabled = audienceRoutesPresent(), browserAssessment = false, browserChat = false, browserDiscovery = false, verifyDiscovery = verifyBrowserDiscovery }) {
  if (browserAssessment && personas.institution?.sessionId !== `${personas.institution?.userId}-assessment-session`) throw new Error("Bounded assessment session required.");
  const contexts = [];
  const clients = {};
  const contextsByRole = {};
  const pendingRoutes = new Set();
  let routeFailed = false;
  // APIRequestContext follows redirects by default, including bearer headers.
  const noRedirectClient = request => ({
    get: (path, options = {}) => request.get(path, { ...options, maxRedirects: 0 }),
    post: (path, options = {}) => request.post(path, { ...options, maxRedirects: 0 }),
  });
  const guardContext = async context => {
    await context.route("**/*", route => {
      // Playwright invokes handlers outside the verification call stack. Never
      // reject here: its raw error can contain cookies and bypass fixture cleanup.
      const handled = (async () => {
        try {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== target.baseUrl || request.redirectedFrom()) return await route.abort();
          // Allow the bounded 60s chat operation to return before the browser's
          // 70s response deadline. Ordinary requests keep their 30s bound.
          const timeout = browserDiscovery && url.pathname === "/api/community/profiles/discover" && request.method() === "POST" ? 75000 : browserChat && url.pathname === "/api/community/chat" && request.method() === "POST" ? 65000 : 30000;
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout });
          if (response.status() >= 300 && response.status() < 400) return await route.abort();
          await route.fulfill({ response });
        } catch {
          routeFailed = true;
          // A closed page can reject abort too. Do not let that second error
          // escape or retain the original exception/headers in diagnostics.
          try { await route.abort(); } catch { /* already closed */ }
        }
      })();
      pendingRoutes.add(handled);
      void handled.then(() => pendingRoutes.delete(handled));
      return handled;
    });
  };
  let failure;
  let stage="identities";
  const requireStatus = (response, status) => {
    if (response.status() !== status) throw new Error("Synthetic staging verification failed.");
  };
  try {
    for (const [name, persona] of Object.entries(personas)) {
      const context = await browser.newContext({ baseURL: target.baseUrl, serviceWorkers: "block" });
      contexts.push(context);
      contextsByRole[name] = context;
      await guardContext(context);
      await context.addCookies(persona.cookies);
      clients[name] = noRedirectClient(context.request);
      const own = await clients[name].get("/api/community/profile");
      requireStatus(own, 200);
      if ((await own.json()).profile?.userId !== persona.userId) throw new Error("Synthetic identity mismatch.");
      const page = await context.newPage();
      const response = await page.goto(`${target.baseUrl}/dashboard/community`, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (!response || response.status() !== 200 || new URL(page.url()).pathname.startsWith("/auth/")) throw new Error("Synthetic browser authentication failed.");
      await page.close();
      requireStatus(await clients[name].get("/api/community/tokens"), 403);
    }
    stage="authorization";
    const profilePath = `/api/community/profiles/${personas.otherMember.userId}`;
    requireStatus(await clients.member.get(profilePath), 403);
    requireStatus(await clients.unapprovedInstitution.get(profilePath), 403);
    requireStatus(await clients.institution.get(profilePath), 200);
    requireStatus(await clients.mentor.get("/api/community/mentorship"), 200);
    requireStatus(await clients.admin.get("/admin/agent-access"), 403);
    const accessChange = { userId: personas.unapprovedInstitution.userId, role: "INSTITUTION", granted: true };
    requireStatus(await clients.admin.post("/api/community/access", { headers: { Origin: target.baseUrl }, data: accessChange }), 200);
    requireStatus(await clients.unapprovedInstitution.get(profilePath), 200);
    requireStatus(await clients.admin.post("/api/community/access", { headers: { Origin: target.baseUrl }, data: { ...accessChange, granted: false } }), 200);
    requireStatus(await clients.unapprovedInstitution.get(profilePath), 403);
    for (const name of ["member", "institution", "unapprovedInstitution"]) {
      const context = await browser.newContext({ baseURL: target.baseUrl, extraHTTPHeaders: { Authorization: `Bearer ${personas[name].personalAccessToken}` } });
      contexts.push(context);
      const client = noRedirectClient(context.request);
      requireStatus(await client.get("/api/community/profile"), 200);
      requireStatus(await client.get(profilePath), name === "institution" ? 200 : 403);
      const initialize = await client.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "ttv-staging-fixture", version: "1" } } } });
      requireStatus(initialize, 200);
      const initialized = await initialize.json();
      if (initialized.error || !initialized.result?.protocolVersion) throw new Error("Synthetic MCP initialization failed.");
    }
    if (browserDiscovery) {stage="discovery";await verifyDiscovery({target,contextsByRole,personas});}
    stage="audience";
    if (audienceEnabled) {
      const anonymousContext = await browser.newContext({ baseURL: target.baseUrl, serviceWorkers: "block" });
      contexts.push(anonymousContext);
      await guardContext(anonymousContext);
      await verifyAudience({ baseUrl: target.baseUrl, contextsByRole, anonymousContext,
        users: Object.fromEntries(["member", "mentor", "institution", "admin"].map(role => [role, { userId: personas[role].userId }])) });
    }
    stage="community-journey";
    await verifyJourney({
      baseUrl: target.baseUrl,
      contextsByRole: Object.fromEntries(["member", "mentor", "institution"].map(role => [role, contextsByRole[role]])),
      users: Object.fromEntries(["member", "mentor", "institution"].map(role => [role, { userId: personas[role].userId }])),
      evidenceDirectory: COMMUNITY_EVIDENCE_DIRECTORY,
      browserAssessment,
      browserChat,
    });
  } catch {
    console.log(JSON.stringify({event:"synthetic-verification-failed",stage}));
    failure = new Error("Synthetic staging verification failed.");
  } finally {
    const outcomes = await Promise.allSettled(contexts.map(context => context.close()));
    // Closing contexts stops requests; drain their contained callbacks before
    // returning to the database lifecycle's finally/credential revocation.
    await Promise.all(pendingRoutes);
    if (outcomes.some(outcome => outcome.status === "rejected")) failure = new Error("Synthetic browser context cleanup failed.");
  }
  if (routeFailed) failure = new Error("Synthetic staging browser request failed.");
  if (failure) throw failure;
}
