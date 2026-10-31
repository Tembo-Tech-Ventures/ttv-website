import { createId } from "@paralleldrive/cuid2";
import { assertAtomicMutationApplied, type AtomicMutationStatement } from "@/lib/admin/program-application";
import { applicationStatusAttention, visitorMessageAttention, type AttentionProducerContext } from "./producers";

/** Called only after the existing admin guard and transition planner succeed. */
export async function applyApplicationMutationWithAttention(context: AttentionProducerContext, input: {
  statement: AtomicMutationStatement;
  applicationIds: readonly string[];
  actorId: string;
  staleCode: "STALE_TRANSITION" | "STALE_BULK_SELECTION";
  staleMessage: string;
}) {
  const result = await context.db.prepare(input.statement.sql).bind(...input.statement.params).run();
  assertAtomicMutationApplied({ ...input, actualChanges: result.meta.changes });
  for (const id of input.applicationIds) await applicationStatusAttention(context, id, input.actorId);
}

/** The public page supplies its loaded profile after form validation and spam guards. */
export async function saveVisitorMessageWithAttention(context: AttentionProducerContext, input: {
  profileId: string;
  fromName: string;
  fromEmail: string;
  organization: string | null;
  message: string;
}) {
  const id = createId();
  await context.db.prepare(`INSERT INTO profileContact(id,profileId,fromName,fromEmail,organization,message)
    VALUES (?,?,?,?,?,?)`).bind(id, input.profileId, input.fromName, input.fromEmail, input.organization, input.message).run();
  await visitorMessageAttention(context, id);
  return id;
}
