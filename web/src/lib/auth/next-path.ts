export const DEFAULT_AUTH_RETURN_PATH = "/dashboard";

const VALIDATION_ORIGIN = "https://tembo.invalid";
const ABSOLUTE_PATH = /^\/(?![\\/])/;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

/**
 * Accept only a same-origin absolute path. URL-like values, protocol-relative
 * paths, backslash variants, encoded protocol-relative paths, and malformed
 * escapes all fall back to the dashboard.
 */
export function validateNextPath(
  value: string | null | undefined
): string {
  if (
    !value ||
    !ABSOLUTE_PATH.test(value) ||
    value.includes("\\") ||
    containsControlCharacter(value)
  ) {
    return DEFAULT_AUTH_RETURN_PATH;
  }

  try {
    const decoded = decodeURIComponent(value);
    if (!ABSOLUTE_PATH.test(decoded) || decoded.includes("\\")) {
      return DEFAULT_AUTH_RETURN_PATH;
    }

    const parsed = new URL(value, VALIDATION_ORIGIN);
    if (parsed.origin !== VALIDATION_ORIGIN) {
      return DEFAULT_AUTH_RETURN_PATH;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_RETURN_PATH;
  }
}
