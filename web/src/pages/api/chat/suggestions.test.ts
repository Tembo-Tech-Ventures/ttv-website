import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { DB: {} as Record<string, unknown> },
  drizzle: vi.fn(),
  getAccessibleProgramIds: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/lib/recordings/access", () => ({
  getAccessibleProgramIds: mocks.getAccessibleProgramIds,
}));

import { GET } from "./suggestions";

interface SuggestionsResponse {
  suggestions: string[];
}

async function json(response: Response) {
  return response.json() as Promise<SuggestionsResponse>;
}

function context(user: Record<string, unknown> | null = { id: "user-1", name: "Test" }) {
  return {
    request: new Request("https://example.com/api/chat/suggestions"),
    locals: { user, isAdmin: false },
  } as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/chat/suggestions", () => {
  it("returns empty suggestions when not authenticated", async () => {
    const response = await GET(context(null));
    const body = await json(response);
    expect(body.suggestions).toEqual([]);
  });

  it("returns program-discovery prompts for non-enrolled users", async () => {
    mocks.getAccessibleProgramIds.mockResolvedValue([]);
    mocks.drizzle.mockReturnValue({});

    const response = await GET(context());
    const body = await json(response);

    expect(body.suggestions).toHaveLength(3);
    expect(body.suggestions).toContain("What programs does TTV offer?");
    expect(body.suggestions).toContain("What's my application status?");
  });

  it("returns recording-based prompts for enrolled users", async () => {
    mocks.getAccessibleProgramIds.mockResolvedValue(["program-1"]);
    const limit = vi.fn().mockResolvedValue([
      { title: "Week 3: Customer Discovery" },
      { title: "Mentor Hours Aug 15" },
    ]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select, from, where, orderBy, limit });

    const response = await GET(context());
    const body = await json(response);

    expect(body.suggestions).toHaveLength(2);
    expect(body.suggestions[0]).toContain("Week 3: Customer Discovery");
    expect(body.suggestions[1]).toContain("Mentor Hours Aug 15");
  });

  it("returns curriculum prompts when enrolled but no recordings exist", async () => {
    mocks.getAccessibleProgramIds.mockResolvedValue(["program-1"]);
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn(() => ({ limit }));
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    mocks.drizzle.mockReturnValue({ select, from, where, orderBy, limit });

    const response = await GET(context());
    const body = await json(response);

    expect(body.suggestions).toHaveLength(3);
    expect(body.suggestions).toContain("Tell me about my program");
  });
});
