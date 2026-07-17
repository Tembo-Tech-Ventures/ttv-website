import { describe, expect, it } from "vitest";
import {
  BoardValidationError,
  calculateBoardProgress,
  formatDateInput,
  getBoardPermissions,
  groupBoardTasksByStatus,
  isTaskOverdue,
  mergeAccessibleBoards,
  parseBoardInput,
  parseBoardTaskInput,
  parseMemberEmail,
  validateAssignee,
} from "./boards";

function form(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

describe("project board input", () => {
  it("trims and validates board fields", () => {
    expect(
      parseBoardInput(
        form({ name: "  Cohort launch  ", description: "  Ship together  " })
      )
    ).toEqual({
      name: "Cohort launch",
      description: "Ship together",
    });
  });

  it("rejects missing and oversized board fields", () => {
    expect(() => parseBoardInput(form({ name: "   " }))).toThrow(
      "Board name is required."
    );
    expect(() =>
      parseBoardInput(form({ name: "Board", description: "x".repeat(501) }))
    ).toThrow("Board description must be 500 characters or fewer.");
  });

  it("parses task status, participant, and due date", () => {
    const input = parseBoardTaskInput(
      form({
        title: "  Demo the prototype  ",
        description: "  Record feedback.  ",
        status: "IN_PROGRESS",
        assigneeId: "user-2",
        dueDate: "2026-08-09",
      })
    );

    expect(input).toEqual({
      title: "Demo the prototype",
      description: "Record feedback.",
      status: "IN_PROGRESS",
      assigneeId: "user-2",
      dueDate: new Date("2026-08-09T00:00:00.000Z"),
    });
    expect(formatDateInput(input.dueDate)).toBe("2026-08-09");
  });

  it("defaults new tasks and rejects invalid status or dates", () => {
    expect(parseBoardTaskInput(form({ title: "Draft outline" }))).toMatchObject({
      status: "TODO",
      assigneeId: null,
      dueDate: null,
    });
    expect(() =>
      parseBoardTaskInput(form({ title: "Draft", status: "BLOCKED" }))
    ).toThrow("Task status is invalid.");
    expect(() =>
      parseBoardTaskInput(form({ title: "Draft", dueDate: "2026-02-30" }))
    ).toThrow("Due date must be a valid date.");
  });

  it("normalizes and validates member email addresses", () => {
    expect(parseMemberEmail(form({ email: "  Ada@Example.COM " }))).toBe(
      "ada@example.com"
    );
    expect(() => parseMemberEmail(form({ email: "not-an-email" }))).toThrow(
      "Enter a valid member email address."
    );
  });
});

describe("project board authorization", () => {
  it("gives owners and members access while keeping member management owner-only", () => {
    expect(getBoardPermissions("owner", ["member"], "owner")).toEqual({
      canView: true,
      canManageTasks: true,
      canManageMembers: true,
      canDeleteBoard: true,
      isOwner: true,
    });
    expect(getBoardPermissions("owner", ["member"], "member")).toEqual({
      canView: true,
      canManageTasks: true,
      canManageMembers: false,
      canDeleteBoard: false,
      isOwner: false,
    });
    expect(getBoardPermissions("owner", ["member"], "outsider").canView).toBe(
      false
    );
  });

  it("only allows assignments to board participants", () => {
    expect(() => validateAssignee(null, ["owner", "member"])).not.toThrow();
    expect(() =>
      validateAssignee("member", ["owner", "member"])
    ).not.toThrow();
    expect(() => validateAssignee("outsider", ["owner", "member"])).toThrow(
      BoardValidationError
    );
  });
});

describe("project board presentation", () => {
  const tasks = [
    { id: "1", status: "TODO" as const },
    { id: "2", status: "IN_PROGRESS" as const },
    { id: "3", status: "DONE" as const },
    { id: "4", status: "DONE" as const },
  ];

  it("groups tasks into all workflow columns", () => {
    const grouped = groupBoardTasksByStatus(tasks);
    expect(grouped.TODO.map(({ id }) => id)).toEqual(["1"]);
    expect(grouped.IN_PROGRESS.map(({ id }) => id)).toEqual(["2"]);
    expect(grouped.DONE.map(({ id }) => id)).toEqual(["3", "4"]);
  });

  it("calculates completion without dividing by zero", () => {
    expect(calculateBoardProgress(tasks)).toEqual({
      total: 4,
      completed: 2,
      percentage: 50,
    });
    expect(calculateBoardProgress([])).toEqual({
      total: 0,
      completed: 0,
      percentage: 0,
    });
  });

  it("deduplicates accessible boards and sorts recent activity first", () => {
    const oldBoard = {
      id: "old",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const newBoard = {
      id: "new",
      updatedAt: new Date("2026-02-01T00:00:00Z"),
    };

    expect(
      mergeAccessibleBoards([oldBoard, newBoard], [oldBoard]).map(
        ({ id }) => id
      )
    ).toEqual(["new", "old"]);
  });

  it("marks unfinished tasks overdue after their due day", () => {
    const today = new Date("2026-07-17T12:00:00Z");
    expect(
      isTaskOverdue(new Date("2026-07-16T00:00:00Z"), "TODO", today)
    ).toBe(true);
    expect(
      isTaskOverdue(new Date("2026-07-17T00:00:00Z"), "TODO", today)
    ).toBe(false);
    expect(
      isTaskOverdue(new Date("2026-07-16T00:00:00Z"), "DONE", today)
    ).toBe(false);
  });
});
