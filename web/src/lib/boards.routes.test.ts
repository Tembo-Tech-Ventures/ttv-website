import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const boardPages = path.resolve(
  import.meta.dirname,
  "..",
  "pages",
  "dashboard",
  "boards"
);

async function readBoardPage(name: string) {
  return readFile(path.join(boardPages, name), "utf8");
}

describe("project board route contracts", () => {
  it("creates boards for the authenticated user and lists owned plus shared boards", async () => {
    const page = await readBoardPage("index.astro");

    expect(page).toContain("const user = Astro.locals.user!");
    expect(page).toContain("parseBoardInput(await Astro.request.formData())");
    expect(page).toContain("ownerId: user.id");
    expect(page).toContain(
      "where: eq(schema.projectBoardMember.userId, user.id)"
    );
    expect(page).toContain("mergeAccessibleBoards(");
  });

  it("checks board access before accepting task or membership mutations", async () => {
    const page = await readBoardPage("[id].astro");

    expect(page).toMatch(
      /getBoardPermissions\(board\.ownerId, memberUserIds, user\.id\);\s*if \(!permissions\.canView\)/
    );
    expect(page.match(/eq\(schema\.projectBoardTask\.boardId, boardId\)/g))
      .toHaveLength(3);
    expect(page).toContain("if (!permissions.canManageMembers)");
    expect(page).toContain("if (!permissions.canDeleteBoard)");
    expect(page).toContain("validateAssignee(input.assigneeId, participants)");
    expect(page).toContain(".set({ assigneeId: null })");
  });

  it("renders the required ownership, deadline, status, and progress controls", async () => {
    const page = await readBoardPage("[id].astro");

    expect(page).toContain('name="assigneeId"');
    expect(page).toContain('name="dueDate"');
    expect(page).toContain("BOARD_STATUSES.map");
    expect(page).toContain('role="progressbar"');
    expect(page).toContain('onsubmit="return confirm(');
  });
});
