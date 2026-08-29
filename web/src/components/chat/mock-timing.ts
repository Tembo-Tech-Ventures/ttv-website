/**
 * Shared by `ChatApp`'s mock mode and the e2e suite, so a test that has to
 * outwait the mock round trip cannot silently stop doing so when this changes.
 *
 * Long enough that "while an answer is in flight" is a state a test can act in;
 * a real retrieval round trip is seconds, not milliseconds.
 */
export const MOCK_LATENCY_MS = 1_500;

/**
 * Loading a saved conversation is one D1 query, not a retrieval round trip.
 * Keeping the mock honest about that matters: the dev page is what design
 * review looks at, and a 1.5s pause there implies a wait production does not
 * have.
 */
export const MOCK_LOAD_MS = 150;
