import { describe, it, expect } from "vitest";
import { contactFormSchema, parseContactForm } from "./contact-helpers";

describe("contactFormSchema", () => {
  it("accepts valid input", () => {
    const result = contactFormSchema.safeParse({
      fromName: "Jane Doe",
      fromEmail: "jane@example.com",
      organization: "Acme Corp",
      message: "Hello, I'd like to connect.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty organization", () => {
    const result = contactFormSchema.safeParse({
      fromName: "Jane",
      fromEmail: "jane@example.com",
      organization: "",
      message: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("accepts missing organization", () => {
    const result = contactFormSchema.safeParse({
      fromName: "Jane",
      fromEmail: "jane@example.com",
      message: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty fromName", () => {
    const result = contactFormSchema.safeParse({
      fromName: "",
      fromEmail: "jane@example.com",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects fromName over 120 chars", () => {
    const result = contactFormSchema.safeParse({
      fromName: "x".repeat(121),
      fromEmail: "jane@example.com",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty fromEmail", () => {
    const result = contactFormSchema.safeParse({
      fromName: "Jane",
      fromEmail: "",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = contactFormSchema.safeParse({
      fromName: "Jane",
      fromEmail: "not-an-email",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects email over 254 chars", () => {
    const localPart = "a".repeat(200);
    const domain = "b".repeat(50) + ".com";
    const result = contactFormSchema.safeParse({
      fromName: "Jane",
      fromEmail: `${localPart}@${domain}`,
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty message", () => {
    const result = contactFormSchema.safeParse({
      fromName: "Jane",
      fromEmail: "jane@example.com",
      message: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects message over 4000 chars", () => {
    const result = contactFormSchema.safeParse({
      fromName: "Jane",
      fromEmail: "jane@example.com",
      message: "x".repeat(4001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects organization over 120 chars", () => {
    const result = contactFormSchema.safeParse({
      fromName: "Jane",
      fromEmail: "jane@example.com",
      organization: "x".repeat(121),
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });
});

describe("parseContactForm", () => {
  function makeFormData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      fd.set(key, value);
    }
    return fd;
  }

  it("returns valid result for correct input", () => {
    const fd = makeFormData({
      fromName: "Jane Doe",
      fromEmail: "jane@example.com",
      organization: "Acme",
      message: "Hello!",
    });
    const result = parseContactForm(fd);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.fromName).toBe("Jane Doe");
      expect(result.data.fromEmail).toBe("jane@example.com");
      expect(result.data.organization).toBe("Acme");
      expect(result.data.message).toBe("Hello!");
    }
  });

  it("returns errors for empty required fields", () => {
    const fd = makeFormData({
      fromName: "",
      fromEmail: "",
      message: "",
    });
    const result = parseContactForm(fd);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.fromName).toBeDefined();
      expect(result.errors.fromEmail).toBeDefined();
      expect(result.errors.message).toBeDefined();
    }
  });

  it("returns errors for invalid email", () => {
    const fd = makeFormData({
      fromName: "Jane",
      fromEmail: "not-email",
      message: "Hello",
    });
    const result = parseContactForm(fd);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.fromEmail).toBeDefined();
    }
  });

  it("preserves input values in error result", () => {
    const fd = makeFormData({
      fromName: "Jane",
      fromEmail: "bad",
      organization: "Acme",
      message: "Hello",
    });
    const result = parseContactForm(fd);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.values.fromName).toBe("Jane");
      expect(result.values.fromEmail).toBe("bad");
      expect(result.values.organization).toBe("Acme");
      expect(result.values.message).toBe("Hello");
    }
  });

  it("handles missing form fields gracefully", () => {
    const fd = new FormData();
    const result = parseContactForm(fd);
    expect(result.valid).toBe(false);
  });

  it("only reports first error per field", () => {
    const fd = makeFormData({
      fromName: "",
      fromEmail: "",
      message: "",
    });
    const result = parseContactForm(fd);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(typeof result.errors.fromName).toBe("string");
      expect(typeof result.errors.fromEmail).toBe("string");
    }
  });
});
