import { and, eq, notExists } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

export interface CurriculumValues {
  title: string;
  description: string;
}

export type CurriculumFieldErrors = Partial<
  Record<keyof CurriculumValues, string>
>;

export type CurriculumValidation =
  | {
      valid: true;
      data: CurriculumValues;
      values: CurriculumValues;
      errors: CurriculumFieldErrors;
    }
  | {
      valid: false;
      values: CurriculumValues;
      errors: CurriculumFieldErrors;
    };

export interface CurriculumProgramUsage {
  id: string;
  name: string;
}

export interface CurriculumRecord extends CurriculumValues {
  id: string;
  programs: CurriculumProgramUsage[];
}

export type CurriculumSaveResult =
  | { ok: true; curriculum: { id: string } }
  | {
      ok: false;
      reason: "validation";
      values: CurriculumValues;
      errors: CurriculumFieldErrors;
    }
  | { ok: false; reason: "not-found"; message: string };

export type CurriculumDeleteResult =
  | { ok: true }
  | { ok: false; reason: "in-use" | "not-found"; message: string };

export interface CurriculumStore {
  list(): Promise<CurriculumRecord[]>;
  findById(id: string): Promise<CurriculumRecord | undefined>;
  create(values: CurriculumValues): Promise<{ id: string }>;
  update(id: string, values: CurriculumValues): Promise<boolean>;
  deleteIfUnused(
    id: string
  ): Promise<"deleted" | "in-use" | "not-found">;
}

function formText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export function curriculumValuesFromFormData(
  formData: FormData
): CurriculumValues {
  return {
    title: formText(formData.get("title")),
    description: formText(formData.get("description")),
  };
}

export function validateCurriculum(
  values: CurriculumValues
): CurriculumValidation {
  const data = {
    title: values.title.trim(),
    description: values.description.trim(),
  };
  const errors: CurriculumFieldErrors = {};

  if (!data.title) errors.title = "Enter a curriculum title.";
  if (!data.description) {
    errors.description = "Enter a curriculum description.";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, values, errors };
  }
  return { valid: true, data, values, errors };
}

export function validateCurriculumSelection(
  curriculumId: string,
  availableCurriculumIds: readonly string[]
): { valid: true; curriculumId: string } | { valid: false; message: string } {
  const normalizedId = curriculumId.trim();
  if (availableCurriculumIds.length === 0) {
    return {
      valid: false,
      message: "Create a curriculum before creating a program.",
    };
  }
  if (!normalizedId || !availableCurriculumIds.includes(normalizedId)) {
    return {
      valid: false,
      message: "Select an available curriculum.",
    };
  }
  return { valid: true, curriculumId: normalizedId };
}

export function createDrizzleCurriculumStore(db: Database): CurriculumStore {
  const findById = async (id: string) =>
    db.query.curriculum.findFirst({
      where: eq(schema.curriculum.id, id),
      columns: { id: true, title: true, description: true },
      with: {
        programs: {
          columns: { id: true, name: true },
          orderBy: (program, { asc }) => [asc(program.name)],
        },
      },
    });

  return {
    async list() {
      return db.query.curriculum.findMany({
        columns: { id: true, title: true, description: true },
        with: {
          programs: {
            columns: { id: true, name: true },
            orderBy: (program, { asc }) => [asc(program.name)],
          },
        },
        orderBy: (curriculum, { asc }) => [asc(curriculum.title)],
      });
    },
    findById,
    async create(values) {
      const [created] = await db
        .insert(schema.curriculum)
        .values(values)
        .returning({ id: schema.curriculum.id });
      if (!created) {
        throw new Error("Curriculum insert did not return a row.");
      }
      return created;
    },
    async update(id, values) {
      const updated = await db
        .update(schema.curriculum)
        .set(values)
        .where(eq(schema.curriculum.id, id))
        .returning({ id: schema.curriculum.id });
      return updated.length > 0;
    },
    async deleteIfUnused(id) {
      const usageQuery = db
        .select({ id: schema.program.id })
        .from(schema.program)
        .where(eq(schema.program.curriculumId, id));
      const deleted = await db
        .delete(schema.curriculum)
        .where(
          and(
            eq(schema.curriculum.id, id),
            notExists(usageQuery)
          )
        )
        .returning({ id: schema.curriculum.id });

      if (deleted.length > 0) return "deleted";
      return (await findById(id)) ? "in-use" : "not-found";
    },
  };
}

export async function listCurricula(
  store: CurriculumStore
): Promise<CurriculumRecord[]> {
  return store.list();
}

export async function getCurriculum(
  store: CurriculumStore,
  id: string
): Promise<CurriculumRecord | undefined> {
  return store.findById(id);
}

export async function createCurriculum(
  store: CurriculumStore,
  values: CurriculumValues
): Promise<CurriculumSaveResult> {
  const validation = validateCurriculum(values);
  if (!validation.valid) {
    return {
      ok: false,
      reason: "validation",
      values: validation.values,
      errors: validation.errors,
    };
  }

  const curriculum = await store.create(validation.data);
  return { ok: true, curriculum };
}

export async function updateCurriculum(
  store: CurriculumStore,
  id: string,
  values: CurriculumValues
): Promise<CurriculumSaveResult> {
  const validation = validateCurriculum(values);
  if (!validation.valid) {
    return {
      ok: false,
      reason: "validation",
      values: validation.values,
      errors: validation.errors,
    };
  }

  if (!(await store.update(id, validation.data))) {
    return {
      ok: false,
      reason: "not-found",
      message: "This curriculum no longer exists.",
    };
  }
  return { ok: true, curriculum: { id } };
}

export async function deleteCurriculum(
  store: CurriculumStore,
  id: string
): Promise<CurriculumDeleteResult> {
  const outcome = await store.deleteIfUnused(id);
  if (outcome === "deleted") return { ok: true };
  if (outcome === "in-use") {
    return {
      ok: false,
      reason: "in-use",
      message:
        "This curriculum is used by one or more programs and cannot be deleted.",
    };
  }
  return {
    ok: false,
    reason: "not-found",
    message: "This curriculum no longer exists.",
  };
}

export function curriculumSaveErrorMessage(): string {
  return "The curriculum could not be saved. Please try again.";
}
