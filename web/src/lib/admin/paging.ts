/*
 * How the admin's long lists are paged: 50 to a page, `?page=` counted from 1,
 * the first page at its plain address, and the pager saying "51–100 of 133".
 */

/** Rows on one page of an admin list: enough to scan, few enough to read on a phone. */
export const ADMIN_PAGE_SIZE = 50;

/** The page asked for in `?page=`, counted from 1; anything else is the first page. */
export function parsePage(value: string | null): number {
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

/** The address of one page, keeping the list's other parameters; the first page has no `page`. */
export function pageHref(url: URL | string, page: number): string {
  const next = new URL(url, "https://ttv.invalid");
  if (page <= 1) next.searchParams.delete("page");
  else next.searchParams.set("page", String(page));
  next.hash = "";
  return `${next.pathname}${next.search}`;
}

/** The last page of a list of `total` rows: 1 for an empty list. */
export function lastPage(total: number): number {
  return Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
}

/** Where a page sits in the whole list, for the pager: "51–100 of 133". */
export function pageSummary(page: number, shown: number, total: number): string {
  if (shown === 0) return `0 of ${total}`;
  const first = (page - 1) * ADMIN_PAGE_SIZE + 1;
  return `${first}–${first + shown - 1} of ${total}`;
}
