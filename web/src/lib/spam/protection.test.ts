import { describe, expect, it, vi } from "vitest";
import {
  HONEYPOT_FIELD,
  issueFormToken,
  validateFormToken,
  hashIp,
  checkAndRecordSubmission,
  guardPublicForm,
} from "./protection";

const SECRET = "test-secret-for-form-protection-tests";
const BASE_TIME = 1722960000000; // fixed timestamp

describe("issueFormToken / validateFormToken", () => {
  it("issues a token that validates within the time window", async () => {
    const token = await issueFormToken(SECRET, BASE_TIME);
    expect(token).toContain(".");

    const valid = await validateFormToken(SECRET, token, BASE_TIME + 5000);
    expect(valid).toBe(true);
  });

  it("rejects tokens submitted too quickly (<3s)", async () => {
    const token = await issueFormToken(SECRET, BASE_TIME);
    const valid = await validateFormToken(SECRET, token, BASE_TIME + 2000);
    expect(valid).toBe(false);
  });

  it("rejects tokens older than 2 hours", async () => {
    const token = await issueFormToken(SECRET, BASE_TIME);
    const twoHoursPlus = BASE_TIME + 7201 * 1000;
    const valid = await validateFormToken(SECRET, token, twoHoursPlus);
    expect(valid).toBe(false);
  });

  it("rejects tokens with tampered signatures", async () => {
    const token = await issueFormToken(SECRET, BASE_TIME);
    const tampered = token.replace(/.$/, "x");
    const valid = await validateFormToken(SECRET, tampered, BASE_TIME + 5000);
    expect(valid).toBe(false);
  });

  it("rejects tokens without separator", async () => {
    const valid = await validateFormToken(SECRET, "noseparator", BASE_TIME);
    expect(valid).toBe(false);
  });
});

describe("hashIp", () => {
  it("produces a deterministic hash", async () => {
    const hash1 = await hashIp(SECRET, "192.168.1.1");
    const hash2 = await hashIp(SECRET, "192.168.1.1");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different IPs", async () => {
    const hash1 = await hashIp(SECRET, "192.168.1.1");
    const hash2 = await hashIp(SECRET, "192.168.1.2");
    expect(hash1).not.toBe(hash2);
  });
});

describe("checkAndRecordSubmission", () => {
  function createMockDb(existingCount = 0, shouldFail = false) {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const deleteWhere = vi.fn().mockReturnValue({
      catch: vi.fn(),
    });

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi
            .fn()
            .mockResolvedValue([{ total: existingCount }]),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    };

    if (shouldFail) {
      db.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error("D1 error")),
        }),
      });
    }

    return db as unknown as Parameters<typeof checkAndRecordSubmission>[0];
  }

  it("allows when under the rate limit", async () => {
    const db = createMockDb(2);
    const result = await checkAndRecordSubmission(
      db,
      "contact",
      "hash123",
      BASE_TIME
    );
    expect(result).toBe(true);
  });

  it("blocks when at the rate limit", async () => {
    const db = createMockDb(5);
    const result = await checkAndRecordSubmission(
      db,
      "contact",
      "hash123",
      BASE_TIME
    );
    expect(result).toBe(false);
  });

  it("fails open on database errors", async () => {
    const db = createMockDb(0, true);
    const result = await checkAndRecordSubmission(
      db,
      "contact",
      "hash123",
      BASE_TIME
    );
    expect(result).toBe(true);
  });
});

describe("guardPublicForm", () => {
  function createMockDb() {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const deleteWhere = vi.fn().mockReturnValue({
      catch: vi.fn(),
    });

    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 0 }]),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    } as unknown as Parameters<typeof guardPublicForm>[0]["db"];
  }

  function makeRequest(ip = "192.168.1.1") {
    return new Request("https://example.com/contact", {
      method: "POST",
      headers: { "cf-connecting-ip": ip },
    });
  }

  it("returns silent success when honeypot is filled", async () => {
    const formData = new FormData();
    formData.set(HONEYPOT_FIELD, "spam-bot-value");

    const result = await guardPublicForm({
      db: createMockDb(),
      secret: SECRET,
      scope: "contact",
      request: makeRequest(),
      formData,
      now: BASE_TIME,
    });

    expect(result).toEqual({ ok: true, silent: true });
  });

  it("rejects when no form token is present", async () => {
    const formData = new FormData();

    const result = await guardPublicForm({
      db: createMockDb(),
      secret: SECRET,
      scope: "contact",
      request: makeRequest(),
      formData,
      now: BASE_TIME,
    });

    expect(result).toEqual({ ok: false, reason: "token" });
  });

  it("rejects when form token is invalid", async () => {
    const formData = new FormData();
    formData.set("_form_token", "fake.token");

    const result = await guardPublicForm({
      db: createMockDb(),
      secret: SECRET,
      scope: "contact",
      request: makeRequest(),
      formData,
      now: BASE_TIME,
    });

    expect(result).toEqual({ ok: false, reason: "token" });
  });

  it("accepts valid submission with proper token", async () => {
    const token = await issueFormToken(SECRET, BASE_TIME);
    const formData = new FormData();
    formData.set("_form_token", token);

    const result = await guardPublicForm({
      db: createMockDb(),
      secret: SECRET,
      scope: "contact",
      request: makeRequest(),
      formData,
      now: BASE_TIME + 5000,
    });

    expect(result).toEqual({ ok: true, silent: false });
  });

  it("uses x-forwarded-for fallback for IP", async () => {
    const token = await issueFormToken(SECRET, BASE_TIME);
    const formData = new FormData();
    formData.set("_form_token", token);

    const request = new Request("https://example.com/contact", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" },
    });

    const result = await guardPublicForm({
      db: createMockDb(),
      secret: SECRET,
      scope: "contact",
      request,
      formData,
      now: BASE_TIME + 5000,
    });

    expect(result).toEqual({ ok: true, silent: false });
  });
});
