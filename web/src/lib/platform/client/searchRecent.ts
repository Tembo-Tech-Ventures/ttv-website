import { SearchQuery } from "../contracts";

export const SEARCH_RECENT_LIMIT = 8;
export interface SearchStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function boundRecentQueries(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  for (const value of values) {
    const parsed = SearchQuery.shape.q.safeParse(typeof value === "string" ? value.trim() : value);
    if (!parsed.success || result.some(q => q.toLowerCase() === parsed.data.toLowerCase())) continue;
    result.push(parsed.data);
    if (result.length === SEARCH_RECENT_LIMIT) break;
  }
  return result;
}

export function readRecentQueries(storage: SearchStorage | undefined, key: string): string[] {
  try {
    const raw = storage?.getItem(key);
    // Reject oversized/corrupt external data before parsing it.
    return raw && raw.length <= 16_384 ? boundRecentQueries(JSON.parse(raw)) : [];
  } catch { return []; }
}

export function writeRecentQueries(storage: SearchStorage | undefined, key: string, values: string[]): void {
  try { storage?.setItem(key, JSON.stringify(boundRecentQueries(values))); } catch { /* Storage is optional. */ }
}
