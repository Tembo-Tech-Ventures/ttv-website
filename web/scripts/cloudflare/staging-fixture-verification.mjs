/** Fixed verification program. Do not accept arbitrary scripts, roles or target IDs from workflow input. */
export async function verifyStagingPersonas({ browser, target, personas }) {
  const contexts = [];
  const clients = {};
  let failure;
  const requireStatus = (response, status) => {
    if (response.status() !== status) throw new Error("Synthetic staging verification failed.");
  };
  try {
    for (const [name, persona] of Object.entries(personas)) {
      const context = await browser.newContext({ baseURL: target.baseUrl });
      contexts.push(context);
      await context.addCookies(persona.cookies);
      clients[name] = context.request;
      const own = await context.request.get("/api/community/profile");
      requireStatus(own, 200);
      if ((await own.json()).profile?.userId !== persona.userId) throw new Error("Synthetic identity mismatch.");
      const page = await context.newPage();
      const response = await page.goto(`${target.baseUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (!response || response.status() !== 200 || new URL(page.url()).pathname.startsWith("/auth/")) throw new Error("Synthetic browser authentication failed.");
      await page.close();
      requireStatus(await context.request.get("/api/community/tokens"), 403);
    }
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
      requireStatus(await context.request.get("/api/community/profile"), 200);
      requireStatus(await context.request.get(profilePath), name === "institution" ? 200 : 403);
      const initialize = await context.request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "ttv-staging-fixture", version: "1" } } } });
      requireStatus(initialize, 200);
      const initialized = await initialize.json();
      if (initialized.error || !initialized.result?.protocolVersion) throw new Error("Synthetic MCP initialization failed.");
    }
  } catch {
    failure = new Error("Synthetic staging verification failed.");
  } finally {
    const outcomes = await Promise.allSettled(contexts.map(context => context.close()));
    if (outcomes.some(outcome => outcome.status === "rejected")) failure = new Error("Synthetic browser context cleanup failed.");
  }
  if (failure) throw failure;
}
