import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_SIZE, lastPage, pageHref, pageSummary, parsePage } from "./paging";

describe("admin list pages", () => {
  it("reads ?page= as a page counted from 1, and anything odd as the first", () => {
    expect(parsePage("3")).toBe(3);
    for (const value of [null, "", "0", "-2", "2.5", "two", "1e3", "9999999"]) expect.soft(parsePage(value), String(value)).toBe(1);
  });

  it("keeps the list's filter in each page's address, and gives the first page none", () => {
    expect(pageHref(new URL("https://ttv.invalid/admin/applications?status=PENDING&page=3#x"), 4)).toBe("/admin/applications?status=PENDING&page=4");
    expect(pageHref(new URL("https://ttv.invalid/admin/applications?status=PENDING&page=3"), 1)).toBe("/admin/applications?status=PENDING");
    expect(pageHref("/admin/users", 2)).toBe("/admin/users?page=2");
  });

  it("counts the pages, an empty list having one", () => {
    expect(lastPage(0)).toBe(1);
    expect(lastPage(ADMIN_PAGE_SIZE)).toBe(1);
    expect(lastPage(ADMIN_PAGE_SIZE + 1)).toBe(2);
  });

  it("says where a page sits in the whole list", () => {
    expect(pageSummary(1, ADMIN_PAGE_SIZE, 133)).toBe("1–50 of 133");
    expect(pageSummary(3, 33, 133)).toBe("101–133 of 133");
    expect(pageSummary(4, 0, 133)).toBe("0 of 133");
  });
});
