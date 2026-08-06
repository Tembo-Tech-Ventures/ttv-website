import { validateCurriculumSelection } from "./curricula";

export interface CreateCohortValues {
  name: string;
  description: string;
  curriculumId: string;
  startDate: string;
  endDate: string;
  applicationsOpen: boolean;
}

export interface CreateCohortData {
  name: string;
  description: string;
  curriculumId: string;
  startDate: Date | null;
  endDate: Date | null;
  applicationsOpen: boolean;
}

export type CreateCohortFieldErrors = Partial<
  Record<
    "name" | "description" | "curriculumId" | "startDate" | "endDate",
    string
  >
>;

export type CreateCohortValidation =
  | {
      valid: true;
      data: CreateCohortData;
      values: CreateCohortValues;
      errors: CreateCohortFieldErrors;
    }
  | {
      valid: false;
      values: CreateCohortValues;
      errors: CreateCohortFieldErrors;
    };

function formText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export function createCohortValuesFromFormData(
  formData: FormData
): CreateCohortValues {
  return {
    name: formText(formData.get("name")),
    description: formText(formData.get("description")),
    curriculumId: formText(formData.get("curriculumId")),
    startDate: formText(formData.get("startDate")),
    endDate: formText(formData.get("endDate")),
    applicationsOpen: formText(formData.get("applicationsOpen")) === "true",
  };
}

type DateParseResult =
  | { valid: true; date: Date | null }
  | { valid: false; message: string };

function parseOptionalIsoDate(value: string): DateParseResult {
  const normalized = value.trim();
  if (!normalized) return { valid: true, date: null };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    return {
      valid: false,
      message: "Enter a real date in YYYY-MM-DD format.",
    };
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return {
      valid: false,
      message: "Enter a real date in YYYY-MM-DD format.",
    };
  }
  return { valid: true, date };
}

export function validateCreateCohort(
  values: CreateCohortValues,
  availableCurriculumIds: readonly string[]
): CreateCohortValidation {
  const name = values.name.trim();
  const description = values.description.trim();
  const errors: CreateCohortFieldErrors = {};

  if (!name) errors.name = "Enter a cohort name.";
  if (!description) errors.description = "Enter a cohort description.";

  const curriculum = validateCurriculumSelection(
    values.curriculumId,
    availableCurriculumIds
  );
  if (!curriculum.valid) errors.curriculumId = curriculum.message;

  const startDate = parseOptionalIsoDate(values.startDate);
  const endDate = parseOptionalIsoDate(values.endDate);
  if (!startDate.valid) errors.startDate = startDate.message;
  if (!endDate.valid) errors.endDate = endDate.message;

  if (
    startDate.valid &&
    endDate.valid &&
    startDate.date &&
    endDate.date &&
    startDate.date > endDate.date
  ) {
    errors.endDate = "End date must be on or after start date.";
  }

  if (
    Object.keys(errors).length > 0 ||
    !curriculum.valid ||
    !startDate.valid ||
    !endDate.valid
  ) {
    return { valid: false, values, errors };
  }

  return {
    valid: true,
    values,
    errors,
    data: {
      name,
      description,
      curriculumId: curriculum.curriculumId,
      startDate: startDate.date,
      endDate: endDate.date,
      applicationsOpen: values.applicationsOpen,
    },
  };
}
