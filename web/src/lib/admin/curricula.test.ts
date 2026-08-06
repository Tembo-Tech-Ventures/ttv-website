import { describe, expect, it, vi } from "vitest";
import {
  createCurriculum,
  curriculumSaveErrorMessage,
  curriculumValuesFromFormData,
  deleteCurriculum,
  getCurriculum,
  listCurricula,
  updateCurriculum,
  validateCurriculum,
  validateCurriculumSelection,
  type CurriculumRecord,
  type CurriculumStore,
} from "./curricula";

const existingCurriculum: CurriculumRecord = {
  id: "curriculum-1",
  title: "Web Foundations",
  description: "Core web skills",
  programs: [{ id: "program-1", name: "Spring Cohort" }],
};

function createStore(
  overrides: Partial<CurriculumStore> = {}
): CurriculumStore {
  return {
    list: vi.fn(async () => [existingCurriculum]),
    findById: vi.fn(async (id) =>
      id === existingCurriculum.id ? existingCurriculum : undefined
    ),
    create: vi.fn(async () => ({ id: "curriculum-new" })),
    update: vi.fn(async (id) => id === existingCurriculum.id),
    deleteIfUnused: vi.fn(async () => "deleted" as const),
    ...overrides,
  };
}

describe("curriculumValuesFromFormData", () => {
  it("reads text fields and ignores non-text values", () => {
    const formData = new FormData();
    formData.set("title", "  Web Foundations  ");
    formData.set("description", new File(["content"], "curriculum.txt"));

    expect(curriculumValuesFromFormData(formData)).toEqual({
      title: "  Web Foundations  ",
      description: "",
    });
  });
});

describe("validateCurriculum", () => {
  it("trims required title and description", () => {
    expect(
      validateCurriculum({
        title: "  Web Foundations  ",
        description: "  Core web skills  ",
      })
    ).toMatchObject({
      valid: true,
      data: {
        title: "Web Foundations",
        description: "Core web skills",
      },
    });
  });

  it("returns inline field errors and preserves invalid submitted values", () => {
    const values = { title: "   ", description: "" };

    expect(validateCurriculum(values)).toEqual({
      valid: false,
      values,
      errors: {
        title: "Enter a curriculum title.",
        description: "Enter a curriculum description.",
      },
    });
  });
});

describe("curriculum queries", () => {
  it("lists curricula with associated program usage", async () => {
    const store = createStore();

    await expect(listCurricula(store)).resolves.toEqual([existingCurriculum]);
    expect(store.list).toHaveBeenCalledOnce();
  });

  it("returns a curriculum by ID or undefined when missing", async () => {
    const store = createStore();

    await expect(getCurriculum(store, "curriculum-1")).resolves.toEqual(
      existingCurriculum
    );
    await expect(getCurriculum(store, "missing")).resolves.toBeUndefined();
  });
});

describe("createCurriculum", () => {
  it("persists normalized values", async () => {
    const store = createStore();

    await expect(
      createCurriculum(store, {
        title: "  Web Foundations  ",
        description: "  Core web skills  ",
      })
    ).resolves.toEqual({
      ok: true,
      curriculum: { id: "curriculum-new" },
    });
    expect(store.create).toHaveBeenCalledWith({
      title: "Web Foundations",
      description: "Core web skills",
    });
  });

  it("does not write invalid values", async () => {
    const store = createStore();

    await expect(
      createCurriculum(store, { title: "", description: "   " })
    ).resolves.toMatchObject({
      ok: false,
      reason: "validation",
      errors: {
        title: "Enter a curriculum title.",
        description: "Enter a curriculum description.",
      },
    });
    expect(store.create).not.toHaveBeenCalled();
  });
});

describe("updateCurriculum", () => {
  it("updates an existing curriculum with normalized values", async () => {
    const store = createStore();

    await expect(
      updateCurriculum(store, "curriculum-1", {
        title: "  Advanced Web  ",
        description: "  Advanced browser skills  ",
      })
    ).resolves.toEqual({
      ok: true,
      curriculum: { id: "curriculum-1" },
    });
    expect(store.update).toHaveBeenCalledWith("curriculum-1", {
      title: "Advanced Web",
      description: "Advanced browser skills",
    });
  });

  it("does not write invalid edits", async () => {
    const store = createStore();

    await expect(
      updateCurriculum(store, "curriculum-1", {
        title: " ",
        description: "Still present",
      })
    ).resolves.toMatchObject({
      ok: false,
      reason: "validation",
      values: { title: " ", description: "Still present" },
    });
    expect(store.update).not.toHaveBeenCalled();
  });

  it("reports a concurrently removed curriculum", async () => {
    const store = createStore({ update: vi.fn(async () => false) });

    await expect(
      updateCurriculum(store, "missing", {
        title: "Web",
        description: "Description",
      })
    ).resolves.toEqual({
      ok: false,
      reason: "not-found",
      message: "This curriculum no longer exists.",
    });
  });
});

describe("deleteCurriculum", () => {
  it("deletes an unused curriculum", async () => {
    const store = createStore();

    await expect(deleteCurriculum(store, "curriculum-1")).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects deletion when a program references the curriculum", async () => {
    const store = createStore({
      deleteIfUnused: vi.fn(async () => "in-use" as const),
    });

    await expect(deleteCurriculum(store, "curriculum-1")).resolves.toEqual({
      ok: false,
      reason: "in-use",
      message:
        "This curriculum is used by one or more programs and cannot be deleted.",
    });
  });

  it("reports a curriculum that was already removed", async () => {
    const store = createStore({
      deleteIfUnused: vi.fn(async () => "not-found" as const),
    });

    await expect(deleteCurriculum(store, "curriculum-1")).resolves.toEqual({
      ok: false,
      reason: "not-found",
      message: "This curriculum no longer exists.",
    });
  });
});

describe("validateCurriculumSelection", () => {
  it("accepts and trims an available curriculum ID", () => {
    expect(validateCurriculumSelection(" curriculum-1 ", ["curriculum-1"])).toEqual({
      valid: true,
      curriculumId: "curriculum-1",
    });
  });

  it("requires administrators to create a curriculum when none exist", () => {
    expect(validateCurriculumSelection("", [])).toEqual({
      valid: false,
      message: "Create a curriculum before creating a program.",
    });
  });

  it("rejects blank and stale curriculum selections", () => {
    expect(validateCurriculumSelection("", ["curriculum-1"])).toEqual({
      valid: false,
      message: "Select an available curriculum.",
    });
    expect(validateCurriculumSelection("missing", ["curriculum-1"])).toEqual({
      valid: false,
      message: "Select an available curriculum.",
    });
  });
});

describe("curriculumSaveErrorMessage", () => {
  it("returns a safe message for unexpected persistence failures", () => {
    expect(curriculumSaveErrorMessage()).toBe(
      "The curriculum could not be saved. Please try again."
    );
  });
});
