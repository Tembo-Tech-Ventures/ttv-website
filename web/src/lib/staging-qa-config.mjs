/** Approved once-only recording QA run; issuance is a separate controlled action. These identifiers and public-key pin are nonsecret. */
export const QA_RUN_ID = 'ee10d30ff8baa864053541e1';
export const QA_COOKIE = '__Host-ttv-retained-qa';
export const QA_MARKER = 'ttv-agent:retained-qa:';
export const QA_KEY_PIN = '1a8ea30be55d21519bc95d1b85eebab128f1c9826608a7fe14c543382155071e';
export const QA_CUTOFF = Date.parse('2026-10-25T23:00:00Z') / 1000;
export const QA_PERSONAS = Object.freeze(['member-noncohort', 'mentor', 'institution']);
export const QA_MAX_TTL_SECONDS = 5 * 3600;
