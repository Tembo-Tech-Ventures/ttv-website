export const BOARD_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;

export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const BOARD_STATUS_LABELS: Record<BoardStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

export class BoardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardValidationError";
  }
}

export interface BoardInput {
  name: string;
  description: string;
}

export interface BoardTaskInput {
  title: string;
  description: string;
  status: BoardStatus;
  assigneeId: string | null;
  dueDate: Date | null;
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requireText(
  formData: FormData,
  key: string,
  label: string,
  maxLength: number
): string {
  const value = getString(formData, key);

  if (!value) {
    throw new BoardValidationError(`${label} is required.`);
  }

  if (value.length > maxLength) {
    throw new BoardValidationError(
      `${label} must be ${maxLength} characters or fewer.`
    );
  }

  return value;
}

function optionalText(
  formData: FormData,
  key: string,
  label: string,
  maxLength: number
): string {
  const value = getString(formData, key);

  if (value.length > maxLength) {
    throw new BoardValidationError(
      `${label} must be ${maxLength} characters or fewer.`
    );
  }

  return value;
}

export function parseBoardInput(formData: FormData): BoardInput {
  return {
    name: requireText(formData, "name", "Board name", 80),
    description: optionalText(
      formData,
      "description",
      "Board description",
      500
    ),
  };
}

export function isBoardStatus(value: string): value is BoardStatus {
  return BOARD_STATUSES.includes(value as BoardStatus);
}

export function formatDateInput(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

function parseDueDate(value: string): Date | null {
  if (!value) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BoardValidationError("Due date must be a valid date.");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDateInput(date) !== value) {
    throw new BoardValidationError("Due date must be a valid date.");
  }

  return date;
}

export function parseBoardTaskInput(formData: FormData): BoardTaskInput {
  const rawStatus = getString(formData, "status") || "TODO";
  if (!isBoardStatus(rawStatus)) {
    throw new BoardValidationError("Task status is invalid.");
  }

  return {
    title: requireText(formData, "title", "Task title", 120),
    description: optionalText(
      formData,
      "description",
      "Task description",
      1_000
    ),
    status: rawStatus,
    assigneeId: getString(formData, "assigneeId") || null,
    dueDate: parseDueDate(getString(formData, "dueDate")),
  };
}

export function parseMemberEmail(formData: FormData): string {
  const email = requireText(formData, "email", "Member email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BoardValidationError("Enter a valid member email address.");
  }

  return email;
}

export function getBoardPermissions(
  ownerId: string,
  memberUserIds: readonly string[],
  userId: string
) {
  const isOwner = ownerId === userId;
  const isMember = memberUserIds.includes(userId);

  return {
    canView: isOwner || isMember,
    canManageTasks: isOwner || isMember,
    canManageMembers: isOwner,
    canDeleteBoard: isOwner,
    isOwner,
  };
}

export function validateAssignee(
  assigneeId: string | null,
  participantUserIds: readonly string[]
): void {
  if (assigneeId && !participantUserIds.includes(assigneeId)) {
    throw new BoardValidationError(
      "Tasks can only be assigned to board participants."
    );
  }
}

export function groupBoardTasksByStatus<T extends { status: BoardStatus }>(
  tasks: readonly T[]
): Record<BoardStatus, T[]> {
  const grouped: Record<BoardStatus, T[]> = {
    TODO: [],
    IN_PROGRESS: [],
    DONE: [],
  };

  for (const task of tasks) {
    grouped[task.status].push(task);
  }

  return grouped;
}

export function calculateBoardProgress(
  tasks: readonly { status: BoardStatus }[]
) {
  const total = tasks.length;
  const completed = tasks.filter(({ status }) => status === "DONE").length;

  return {
    total,
    completed,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

function updatedAtValue(value: Date | number | string): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function mergeAccessibleBoards<
  T extends { id: string; updatedAt: Date | number | string },
>(ownedBoards: readonly T[], sharedBoards: readonly T[]): T[] {
  const byId = new Map<string, T>();

  for (const board of [...ownedBoards, ...sharedBoards]) {
    byId.set(board.id, board);
  }

  return [...byId.values()].sort(
    (left, right) =>
      updatedAtValue(right.updatedAt) - updatedAtValue(left.updatedAt)
  );
}

export function isTaskOverdue(
  dueDate: Date | null,
  status: BoardStatus,
  today = new Date()
): boolean {
  return Boolean(
    dueDate &&
      status !== "DONE" &&
      formatDateInput(dueDate) < formatDateInput(today)
  );
}
