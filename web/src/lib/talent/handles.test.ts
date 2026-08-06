import { describe, expect, it } from "vitest";
import {
  normalizeHandle,
  validateHandle,
  RESERVED_HANDLES,
} from "./handles";

describe("normalizeHandle", () => {
  it("lowercases and trims", () => {
    expect(normalizeHandle("  FooBar  ")).toBe("foobar");
    expect(normalizeHandle("HELLO")).toBe("hello");
  });
});

describe("validateHandle", () => {
  it("accepts valid handles", () => {
    expect(validateHandle("abc")).toEqual({ ok: true });
    expect(validateHandle("my-handle-01")).toEqual({ ok: true });
    expect(validateHandle("a".repeat(39))).toEqual({ ok: true });
  });

  it("rejects handles shorter than 3 chars", () => {
    expect(validateHandle("ab")).toEqual({ ok: false, error: "too_short" });
    expect(validateHandle("")).toEqual({ ok: false, error: "too_short" });
  });

  it("rejects handles longer than 39 chars", () => {
    expect(validateHandle("a".repeat(40))).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("rejects handles with invalid characters", () => {
    expect(validateHandle("has_underscore")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    expect(validateHandle("has space")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    expect(validateHandle("UPPER")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    expect(validateHandle("has.dot")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
  });

  it("rejects leading or trailing hyphens", () => {
    expect(validateHandle("-leading")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
    expect(validateHandle("trailing-")).toEqual({
      ok: false,
      error: "invalid_chars",
    });
  });

  it("rejects double hyphens", () => {
    expect(validateHandle("has--double")).toEqual({
      ok: false,
      error: "double_hyphen",
    });
  });

  it("rejects reserved handles", () => {
    expect(validateHandle("admin")).toEqual({
      ok: false,
      error: "reserved",
    });
    expect(validateHandle("dashboard")).toEqual({
      ok: false,
      error: "reserved",
    });
    expect(validateHandle("talent")).toEqual({
      ok: false,
      error: "reserved",
    });
  });

  it("RESERVED_HANDLES includes all required entries", () => {
    const required = [
      "admin",
      "api",
      "auth",
      "dashboard",
      "talent",
      "hire",
      "blog",
      "certificate",
      "www",
      "app",
      "staging",
      "mail",
      "about",
      "contact",
      "legal",
      "privacy",
      "terms",
      "ttv",
      "tembo",
      "root",
      "support",
      "help",
      "team",
      "careers",
      "new",
      "edit",
      "me",
      "profile",
      "profiles",
      "settings",
    ];
    for (const h of required) {
      expect(RESERVED_HANDLES.has(h)).toBe(true);
    }
  });
});
