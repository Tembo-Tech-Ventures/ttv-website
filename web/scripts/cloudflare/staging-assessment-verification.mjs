import { STAGING_FIXTURE_ORIGIN } from "./staging-fixture-target.mjs";

const MODEL = "workers-ai/@cf/google/gemma-4-26b-a4b-it";
const rubric = { id: "synthetic-hiring", version: 1, criteria: [{ id: "typescript", label: "Documented TypeScript contribution", terms: ["TypeScript"] }] };

/** Fixed program: no arbitrary endpoint, prompt, identity, retries or live chat. */
export async function verifyStagingAssessment({ target, personas, fetchImpl = fetch, now = Date.now, progress = () => {} }) {
  let stage = "client-preflight";
  const enter = value => { stage = value; progress({ stage, code: "started" }); };
  const fail = (code = "validation-failed") => {
    progress({ stage, code });
    throw new Error("Synthetic assessment verification failed.");
  };
  enter(stage);
  if (target.baseUrl !== STAGING_FIXTURE_ORIGIN || !/^[a-f0-9]{40}$/.test(target.expectedVersion ?? "")) fail();
  const { member, otherMember, institution, unapprovedInstitution } = personas;
  if (![member, otherMember, institution, unapprovedInstitution].every(p => p?.runId === member?.runId && /^[a-f0-9]{24}$/.test(p?.runId ?? "") && p.userId.startsWith(`ttv-staging-fixture-${p.runId}-`)) ||
      ![member,institution,unapprovedInstitution].every(p=>p.personalAccessToken)) fail();
  if (institution.sessionId !== `${institution.userId}-assessment-session`) fail();
  async function request(persona, path, method = "GET", data) {
    let response;
    try { response = await fetchImpl(`${STAGING_FIXTURE_ORIGIN}/api/community/${path}`, {
      method, redirect: "error", signal: globalThis.AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${persona.personalAccessToken}`, "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    } catch { fail("transport-failed"); }
    progress({ stage, code: "http-response", httpStatus: response.status });
    // Never read or publish error bodies, which may include authentication details.
    if (!response.ok) return { status: response.status };
    const reader = response.body?.getReader();
    if (!reader) fail("response-read-failed");
    let text = "", bytes = 0;
    const decoder = new globalThis.TextDecoder();
    try {
      while (true) {
        let part;
        try { part = await reader.read(); } catch { fail("response-read-failed"); }
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 64000) { await reader.cancel(); fail("response-too-large"); }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let parsed;
    try { parsed = JSON.parse(text); } catch { fail("response-json-invalid"); }
    return { status: response.status, data: parsed };
  }
  enter("profile-write");
  const profile = await request(member, "profile", "PUT", { headline: "", bio: "", skills: [], opportunityGoals: "Synthetic hiring demonstration" });
  if (profile.status !== 200 || profile.data?.profile?.userId !== member.userId) fail();
  enter("journey-write");
  const created = await request(member, "journey", "POST", { title: "Fictional TypeScript contribution", description: "Synthetic example: implemented typed input validation and unit tests for a TypeScript library. Self-reported contribution; external artifact not reviewed.", occurredAt: "2026-10-24", visibility: "institution" });
  const entry = created.data?.entry;
  if (created.status !== 201 || !entry?.id || entry.userId !== member.userId || entry.version !== 1) fail();
  const path = `profiles/${member.userId}/assessment`;
  enter("denied-role");
  const denied = await request(unapprovedInstitution, path, "POST", rubric);
  if (denied.status !== 403) fail();
  enter("no-evidence");
  const empty = await request(institution, `profiles/${otherMember.userId}/assessment`, "POST", rubric);
  if (empty.status !== 200 || empty.data?.assessment?.status !== "completed" || empty.data.assessment.model !== null ||
      empty.data.assessment.criteria?.length !== 1 || empty.data.assessment.criteria[0].status !== "insufficient" ||
      empty.data.assessment.criteria[0].rating !== null || empty.data.assessment.criteria[0].citations?.length !== 0 || empty.data.probe?.claimed !== false) fail();
  enter("assessment");
  const started = now();
  // Exactly one evidence-bearing assessment request; fetch itself never retries.
  const result = await request(institution, path, "POST", rubric);
  const elapsedMs = now() - started;
  const assessment = result.data?.assessment;
  const probe = result.data?.probe;
  progress({ stage, code: "assessment-response", claimed: probe?.claimed, payloadBytes: probe?.payloadBytes, payloadCharacters: probe?.payloadCharacters, assessmentStatus: assessment?.status, assessmentErrorCode: assessment?.errorCode });
  if (result.status !== 200 || assessment?.status !== "completed" || assessment.model !== MODEL ||
      assessment.subject?.userId !== member.userId || assessment.criteria?.length !== 1 ||
      probe?.claimed !== true || !Number.isInteger(probe.payloadBytes) || probe.payloadBytes < 1 || probe.payloadBytes > 8000 ||
      !Number.isInteger(probe.payloadCharacters) || probe.payloadCharacters < 1 || probe.payloadCharacters > 8000) fail();
  enter("assessment-validation");
  const criterion = assessment.criteria[0];
  if (criterion.criterionId !== "typescript" || !["assessed", "insufficient", "uncertain", "contradictory"].includes(criterion.status) ||
      (criterion.status === "assessed" ? !Number.isInteger(criterion.rating) || criterion.rating < 1 || criterion.rating > 5 : criterion.rating !== null) || !Array.isArray(criterion.citations)) fail();
  if (criterion.status === "insufficient" ? criterion.citations.length > 0 : criterion.citations.length === 0) fail();
  const citations = criterion.citations.map(c => {
    if (c.kind !== "journey" || c.id !== entry.id || c.version !== entry.version || c.userId !== member.userId) fail();
    return { kind: "journey", id: entry.id, version: entry.version };
  });
  // Verify durable consumption through a read, never issue a second model request.
  enter("consumed-session");
  const consumed = await request(institution, `profiles/${member.userId}`);
  if (![401, 403].includes(consumed.status)) fail();
  return { version: target.expectedVersion, environment: "staging", verification: "deployed-assessment-http", synthetic: true,
    model: MODEL, assessmentRequests: 1, providerAttemptClaimed: true, payloadBytes: probe.payloadBytes, payloadCharacters: probe.payloadCharacters,
    elapsedMs, timeoutMs: 20000, outputTokenLimit: 3000, retries: 0, usage: "unavailable", billing: "unavailable",
    noEvidence: "insufficient-without-model", deniedRoleHttpStatus: 403, consumedIdentityHttpStatus: consumed.status,
    criterion: { id: "typescript", status: criterion.status, rating: criterion.rating, citations } };
}
