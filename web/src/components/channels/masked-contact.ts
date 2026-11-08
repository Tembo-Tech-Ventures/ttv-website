/**
 * The marker the server writes in place of contact details a moderator has not checked yet (QA2-08), as
 * `MASKED_CONTACT` in contracts.ts says it. A plain string here, so the islands that show stored text
 * do not carry the contract's schemas for one constant; MaskedText.test.tsx holds the two equal.
 */
export const MASKED_CONTACT = "[contact details hidden until a moderator checks this message]";
