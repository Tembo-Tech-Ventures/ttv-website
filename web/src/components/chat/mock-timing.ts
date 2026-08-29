/**
 * Shared by `ChatApp`'s mock mode and the e2e suite, so a test that has to
 * outwait the mock round trip cannot silently stop doing so when this changes.
 *
 * Long enough that "while an answer is in flight" is a state a test can act in;
 * a real retrieval round trip is seconds, not milliseconds.
 */
export const MOCK_LATENCY_MS = 1_500;
