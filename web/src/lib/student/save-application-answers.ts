import {
  canEditAnswers,
  parseApplicationAnswers,
  readAnswerSubmission,
  writeAnswers,
  type ApplicationAnswerDrafts,
} from "./application-answers";

/**
 * Saves a member's answers to their own pending application, from the answers
 * form on /dashboard/application/[id].
 *
 * Only the application's own questions are read from the form (never a raw
 * JSON field), and the write is guarded on the row still being this member's,
 * still PENDING and still holding exactly the text the answers were written
 * into. Anything that changed in between is a lost race, and nothing is
 * written.
 */
export type SaveApplicationAnswersResult =
  /** Not this member's application (or outside their allowed cohort). */
  | { kind: "not-found" }
  /** Nothing a member can answer here: no questions, or no longer pending. */
  | { kind: "not-editable" }
  | { kind: "invalid"; drafts: ApplicationAnswerDrafts; errors: Readonly<Record<string, string>> }
  | { kind: "saved"; application: string }
  /** It was reviewed or changed while the form was open. */
  | { kind: "stale" }
  | { kind: "failed"; drafts: ApplicationAnswerDrafts };

export interface SaveApplicationAnswersInput {
  db: D1Database;
  userId: string;
  applicationId: string;
  /** Restricts the write to one cohort (the staging demo's fictional cohort). */
  programId?: string;
  read: (field: string) => FormDataEntryValue | null;
}

interface StoredApplication {
  status: string;
  application: string;
}

export async function saveApplicationAnswers({
  db,
  userId,
  applicationId,
  programId,
  read,
}: SaveApplicationAnswersInput): Promise<SaveApplicationAnswersResult> {
  const scope = programId === undefined ? "" : ' AND "programId" = ?';
  const scopeParams = programId === undefined ? [] : [programId];

  const stored = await db
    .prepare(`SELECT "status", "application" FROM "programApplication" WHERE "id" = ? AND "userId" = ?${scope}`)
    .bind(applicationId, userId, ...scopeParams)
    .first<StoredApplication>();
  if (!stored) return { kind: "not-found" };

  const answers = parseApplicationAnswers(stored.application);
  if (answers.kind !== "questions" || !canEditAnswers(answers, stored.status)) return { kind: "not-editable" };

  const submission = readAnswerSubmission(answers.questions, read);
  if (!submission.ok) return { kind: "invalid", drafts: submission.drafts, errors: submission.errors };

  const written = writeAnswers(stored.application, submission.values);
  try {
    const result = await db
      .prepare(
        `UPDATE "programApplication" SET "application" = ?
         WHERE "id" = ? AND "userId" = ? AND "status" = 'PENDING' AND "application" = ?${scope}`,
      )
      .bind(written, applicationId, userId, stored.application, ...scopeParams)
      .run();
    return result.meta.changes === 1 ? { kind: "saved", application: written } : { kind: "stale" };
  } catch {
    return { kind: "failed", drafts: submission.drafts };
  }
}
