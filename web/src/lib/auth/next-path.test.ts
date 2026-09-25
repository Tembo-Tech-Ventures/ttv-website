import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTH_RETURN_PATH,
  validateNextPath,
} from "./next-path";

describe("validateNextPath", () => {
  it.each([
    "/dashboard/apply",
    "/dashboard/apply?program=cohort-04",
    "/talent#builders",
  ])("accepts same-origin absolute path %s", (path) => {
    expect(validateNextPath(path)).toBe(path);
  });

  it.each([
    "https://example.com/dashboard/apply",
    "http://example.com/dashboard/apply",
    "//example.com/dashboard/apply",
    "/\\example.com/dashboard/apply",
    "/%2Fexample.com/dashboard/apply",
    ["java", "script:alert(1)"].join(""),
    "dashboard/apply",
    "./dashboard/apply",
    "",
  ])("rejects unsafe or non-absolute next path %j", (path) => {
    expect(validateNextPath(path)).toBe(DEFAULT_AUTH_RETURN_PATH);
  });

  it("uses the dashboard when the next parameter is absent", () => {
    expect(validateNextPath(null)).toBe(DEFAULT_AUTH_RETURN_PATH);
    expect(validateNextPath(undefined)).toBe(DEFAULT_AUTH_RETURN_PATH);
  });
});
