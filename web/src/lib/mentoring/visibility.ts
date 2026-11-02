/**
 * What a check on a request's note (README.md beside this file, "Checks") changes, as SQL over a
 * mentor_request alias. Each is one primary-key lookup per request in mentor_request_case or
 * mentor_request_report.
 */

/** Request `r` has an open check: it holds no spot, and its mentor cannot act on it. */
export const HELD = (r: string) =>
  `EXISTS (SELECT 1 FROM mentor_request_case hc WHERE hc.requestId = ${r}.id AND hc.state = 'OPEN')`;

/**
 * The mentor may see request `r`: it has no check, or its check was opened by the mentor's own report
 * (they read it already), or an admin kept it. A request Clef held stays out of the mentor's sight
 * while open, and for good once removed.
 */
export const MENTOR_SEES = (r: string) => `NOT EXISTS (SELECT 1 FROM mentor_request_case vc WHERE vc.requestId = ${r}.id
  AND (vc.state = 'OPEN' OR vc.decision = 'REMOVE')
  AND NOT EXISTS (SELECT 1 FROM mentor_request_report vr WHERE vr.requestId = vc.requestId))`;
