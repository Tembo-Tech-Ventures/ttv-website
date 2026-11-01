import { describe, expect, it, vi } from "vitest";
import { OnboardingError } from "@/lib/onboarding/service";
import type { AdminAccessRequest } from "@/lib/platform/contracts";
import {
  addressName, changeCommunityRole, COMMUNITY_ROLE_FAILED, communityRoleNotice, communityRoleRedirect, countPendingAccessRequests, decisionFailure, decisionNotice, displayLink,
  githubProfileUrl, isDelegatedCredential, isOwnRepeatDecision, parseCommunityRoleAction, parseDecisionForm,
} from "./access-requests";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const requester = { id: "user-mercy", name: "Mercy Wambui", avatarUrl: null, roleBadges: [] };

describe("parseDecisionForm", () => {
  it("approves without a message, even when one was typed: approval shows no message to anyone", () => {
    expect(parseDecisionForm(form({ id: "request-1", decision: "approve", message: "Welcome aboard" })))
      .toEqual({ ok: true, id: "request-1", decision: { decision: "approve" } });
  });

  it("declines with the trimmed message, or with none when it is blank", () => {
    expect(parseDecisionForm(form({ id: "request-1", decision: "decline", message: "  Tell us more.  " })))
      .toEqual({ ok: true, id: "request-1", decision: { decision: "decline", message: "Tell us more." } });
    expect(parseDecisionForm(form({ id: "request-1", decision: "decline", message: "   " })))
      .toEqual({ ok: true, id: "request-1", decision: { decision: "decline" } });
    expect(parseDecisionForm(form({ id: "request-1", decision: "decline" })))
      .toEqual({ ok: true, id: "request-1", decision: { decision: "decline" } });
  });

  it("keeps a message to 600 characters, and says so beside that request", () => {
    expect(parseDecisionForm(form({ id: "request-1", decision: "decline", message: "a".repeat(600) })).ok).toBe(true);
    expect(parseDecisionForm(form({ id: "request-1", decision: "decline", message: "a".repeat(601) })))
      .toEqual({ ok: false, id: "request-1", error: "Keep the message to 600 characters or fewer." });
  });

  it("refuses a form without a request or a known decision", () => {
    expect(parseDecisionForm(form({ decision: "approve" }))).toMatchObject({ ok: false, id: null });
    expect(parseDecisionForm(form({ id: "request-1", decision: "grant" }))).toMatchObject({ ok: false, id: "request-1" });
    expect(parseDecisionForm(form({ id: "", decision: "decline" }))).toMatchObject({ ok: false, id: null });
  });
});

describe("decisionFailure", () => {
  it("answers an already-decided or withdrawn request with 409 and plain copy", () => {
    expect(decisionFailure(new OnboardingError("conflict", "This request was already decided or withdrawn."))).toEqual({
      status: 409,
      message: "Someone already decided this request, or the person withdrew it, so nothing changed. The list below is up to date.",
    });
  });

  it("answers a missing request with 404", () => {
    expect(decisionFailure(new OnboardingError("not_found", "Request not found."))?.status).toBe(404);
  });

  it("leaves anything unexpected to propagate", () => {
    expect(decisionFailure(new OnboardingError("rate_limited", "Slow down.", 1000))).toBeNull();
    expect(decisionFailure(new Error("D1 is down"))).toBeNull();
  });
});

describe("isOwnRepeatDecision", () => {
  const admin = { id: "admin-1", name: "Amina Hassan", avatarUrl: null, roleBadges: [] };
  const other = { ...admin, id: "admin-2" };

  it("reads a double-submit of the same decision by the same administrator as done", () => {
    expect(isOwnRepeatDecision({ status: "APPROVED", decidedBy: admin }, "admin-1", "approve")).toBe(true);
    expect(isOwnRepeatDecision({ status: "DECLINED", decidedBy: admin }, "admin-1", "decline")).toBe(true);
  });

  it("keeps the 409 for someone else's decision, a different outcome, a withdrawal or a missing request", () => {
    expect(isOwnRepeatDecision({ status: "APPROVED", decidedBy: other }, "admin-1", "approve")).toBe(false);
    expect(isOwnRepeatDecision({ status: "DECLINED", decidedBy: admin }, "admin-1", "approve")).toBe(false);
    expect(isOwnRepeatDecision({ status: "WITHDRAWN", decidedBy: null }, "admin-1", "decline")).toBe(false);
    expect(isOwnRepeatDecision({ status: "APPROVED", decidedBy: null }, "admin-1", "approve")).toBe(false);
    expect(isOwnRepeatDecision(null, "admin-1", "approve")).toBe(false);
  });
});

describe("decisionNotice", () => {
  const decided = (overrides: Partial<AdminAccessRequest>) =>
    ({ role: "MENTOR", status: "APPROVED", decisionMessage: null, requester, ...overrides }) as AdminAccessRequest;

  it("says who now has which access after an approval", () => {
    expect(decisionNotice(decided({}))).toBe("Approved. Mercy Wambui was given mentor access.");
    expect(decisionNotice(decided({ role: "INSTITUTION" }))).toBe("Approved. Mercy Wambui was given institution access.");
  });

  it("says the person sees a message but never the administrator's name", () => {
    expect(decisionNotice(decided({ status: "DECLINED", decisionMessage: "Tell us more." })))
      .toBe("Declined. Mercy will see your message, not your name.");
    expect(decisionNotice(decided({ status: "DECLINED" })))
      .toBe("Declined. Mercy stays a member and can send a new request later.");
  });

  it("says nothing for a request still open", () => {
    expect(decisionNotice(decided({ status: "PENDING" }))).toBeNull();
    expect(decisionNotice(decided({ status: "WITHDRAWN" }))).toBeNull();
  });
});

describe("isDelegatedCredential", () => {
  it("refuses personal access tokens and agent sessions, and admits browser sessions", () => {
    const browser = { session: { userAgent: "Mozilla/5.0" } } as Pick<App.Locals, "personalAccessToken" | "session">;
    const agent = { session: { userAgent: "ttv-agent:triage" } } as typeof browser;
    const token = { personalAccessToken: { scopes: ["admin:read"] } } as unknown as typeof browser;
    expect(isDelegatedCredential(browser)).toBe(false);
    expect(isDelegatedCredential({} as typeof browser)).toBe(false);
    expect(isDelegatedCredential(agent)).toBe(true);
    expect(isDelegatedCredential(token)).toBe(true);
  });
});

describe("countPendingAccessRequests", () => {
  it("counts open requests", async () => {
    const first = vi.fn().mockResolvedValue({ count: 3 });
    const prepare = vi.fn().mockReturnValue({ first });
    await expect(countPendingAccessRequests({ prepare } as unknown as D1Database)).resolves.toBe(3);
    expect(prepare).toHaveBeenCalledWith("SELECT count(*) AS count FROM access_request WHERE status = 'PENDING'");
  });

  it("shows no badge rather than failing an admin page when the count cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prepare = vi.fn().mockReturnValue({ first: vi.fn().mockRejectedValue(new Error("no such table")) });
    await expect(countPendingAccessRequests({ prepare } as unknown as D1Database)).resolves.toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("the words the queue uses", () => {
  it("writes to people by first name", () => {
    expect(addressName("Mercy Wambui")).toBe("Mercy");
    expect(addressName("   ")).toBe("them");
  });

  it("links a GitHub login only when GitHub would accept it", () => {
    expect(githubProfileUrl("mercy-w")).toBe("https://github.com/mercy-w");
    expect(githubProfileUrl(null)).toBeNull();
    expect(["-mercy", "mercy-", "mer--cy", "mercy/../evil", "a".repeat(40), "mercy?tab=x"].map(githubProfileUrl))
      .toEqual([null, null, null, null, null, null]);
  });

  it("writes links the short way people read them", () => {
    expect(displayLink("https://www.github.com/mercy-w/")).toBe("github.com/mercy-w");
    expect(displayLink("https://mto.example")).toBe("mto.example");
    expect(displayLink(`https://mto.example/${"a".repeat(80)}`)).toHaveLength(48);
  });
});

describe("mentor and institution controls", () => {
  it("reads only the four known actions", () => {
    expect(parseCommunityRoleAction("grant-MENTOR")).toEqual({ kind: "grant", role: "MENTOR" });
    expect(parseCommunityRoleAction("revoke-INSTITUTION")).toEqual({ kind: "revoke", role: "INSTITUTION" });
    expect(["grant-ADMIN", "add-admin", "revoke-mentor", "grant-MENTOR ", null].map(parseCommunityRoleAction))
      .toEqual([null, null, null, null, null]);
  });

  it("lands back on the user page's section, saying what changed", () => {
    expect(communityRoleRedirect("user/1", { kind: "revoke", role: "MENTOR" }))
      .toBe("/admin/users/user%2F1?access=revoked&accessRole=MENTOR#community-access");
    expect(communityRoleRedirect("user-1", { kind: "grant", role: "INSTITUTION" }))
      .toBe("/admin/users/user-1?access=granted&accessRole=INSTITUTION#community-access");
  });

  describe("changeCommunityRole", () => {
    const context = { db: {} as D1Database, env: {} };
    const writers = () => ({ grant: vi.fn().mockResolvedValue(undefined), revoke: vi.fn().mockResolvedValue(undefined) });

    it("gives a role with the administrator as the actor, and lands back on the user page", async () => {
      const w = writers();
      await expect(changeCommunityRole(w, context, { userId: "user-1", actorId: "admin-1", action: { kind: "grant", role: "MENTOR" } }))
        .resolves.toEqual({ ok: true, redirect: "/admin/users/user-1?access=granted&accessRole=MENTOR#community-access" });
      expect(w.grant).toHaveBeenCalledWith(context, { userId: "user-1", role: "MENTOR", actorId: "admin-1" });
      expect(w.revoke).not.toHaveBeenCalled();
    });

    it("removes a role", async () => {
      const w = writers();
      await expect(changeCommunityRole(w, context, { userId: "user-1", actorId: "admin-1", action: { kind: "revoke", role: "INSTITUTION" } }))
        .resolves.toMatchObject({ ok: true });
      expect(w.revoke).toHaveBeenCalledWith(context.db, "user-1", "INSTITUTION");
      expect(w.grant).not.toHaveBeenCalled();
    });

    it("reports a failed write as a message for the page instead of throwing", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      for (const kind of ["grant", "revoke"] as const) {
        const w = writers();
        w[kind].mockRejectedValue(new Error("D1_ERROR: batch aborted"));
        await expect(changeCommunityRole(w, context, { userId: "user-1", actorId: "admin-1", action: { kind, role: "MENTOR" } }))
          .resolves.toEqual({ ok: false, error: COMMUNITY_ROLE_FAILED });
      }
      expect(error).toHaveBeenCalledTimes(2);
      error.mockRestore();
    });
  });

  it("reads the outcome back from the redirect, and nothing else", () => {
    expect(communityRoleNotice("granted", "MENTOR")).toBe("Mentor access was given.");
    expect(communityRoleNotice("revoked", "INSTITUTION")).toBe("Institution access was removed.");
    expect(communityRoleNotice("granted", "ADMIN")).toBeNull();
    expect(communityRoleNotice("<b>", "MENTOR")).toBeNull();
    expect(communityRoleNotice(null, null)).toBeNull();
  });
});
