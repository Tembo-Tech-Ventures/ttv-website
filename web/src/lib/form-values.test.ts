import { describe, expect, it } from "vitest";
import { preserveFormTextValues } from "./form-values";

describe("preserveFormTextValues", () => {
  it("preserves every submitted text value exactly", () => {
    const formData = new FormData();
    formData.set("bio", "Building tools with my community.\nSecond line.");
    formData.set("skills", "TypeScript, A skill longer than thirty characters");
    formData.set("country", "Côte d’Ivoire");

    expect(
      preserveFormTextValues(formData, ["bio", "skills", "country"]),
    ).toEqual({
      bio: "Building tools with my community.\nSecond line.",
      skills: "TypeScript, A skill longer than thirty characters",
      country: "Côte d’Ivoire",
    });
  });

  it("returns an empty string for omitted or non-text fields", () => {
    const formData = new FormData();
    formData.set("present", "");
    formData.set("upload", new File(["test"], "test.txt"));

    expect(
      preserveFormTextValues(formData, ["present", "missing", "upload"]),
    ).toEqual({
      present: "",
      missing: "",
      upload: "",
    });
  });
});
