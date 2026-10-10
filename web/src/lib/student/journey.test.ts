import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/schema";
import { getAccessibleProgramIds } from "@/lib/recordings/access";
import { hasCompletedCohort } from "@/lib/talent/eligibility";
import {
  formatJourneyDate,
  getStudentJourney,
  type StudentJourneyState,
} from "./journey";

vi.mock("@/lib/recordings/access", () => ({
  getAccessibleProgramIds: vi.fn(),
}));

vi.mock("@/lib/talent/eligibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/talent/eligibility")>();
  return {
    ...actual,
    hasCompletedCohort: vi.fn(),
  };
});

const START_DATE = new Date("2026-10-06T00:00:00.000Z");
const END_DATE = new Date("2026-12-18T00:00:00.000Z");
const CREATED_AT = new Date("2026-09-20T00:00:00.000Z");

const PROGRAM = {
  id: "program-1",
  name: "Builders Cohort",
  startDate: START_DATE,
  endDate: END_DATE,
};

type Application = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "AUDIT" | "COMPLETED";
  completedAt: Date | null;
  createdAt: Date;
  program: typeof PROGRAM;
};

function application(
  status: Application["status"],
  completedAt: Date | null = null
): Application {
  return {
    id: `application-${status.toLowerCase()}`,
    status,
    completedAt,
    createdAt: CREATED_AT,
    program: PROGRAM,
  };
}

function createDatabase({
  applications = [],
  profile = null,
  openProgram = PROGRAM,
  unreadLeadCount = 0,
}: {
  applications?: Application[];
  profile?: { id: string; status: "DRAFT" | "PUBLISHED" | "SUSPENDED" } | null;
  openProgram?: typeof PROGRAM | null;
  unreadLeadCount?: number;
}) {
  const where = vi.fn().mockResolvedValue([{ value: unreadLeadCount }]);
  const from = vi.fn(() => ({ where }));

  return {
    query: {
      programApplication: {
        findMany: vi.fn().mockResolvedValue(applications),
      },
      studentProfile: {
        findFirst: vi.fn().mockResolvedValue(profile),
      },
      program: {
        findFirst: vi.fn().mockResolvedValue(openProgram),
      },
    },
    select: vi.fn(() => ({ from })),
  } as unknown as Database;
}

describe("student journey", () => {
  beforeEach(() => {
    vi.mocked(getAccessibleProgramIds).mockReset().mockResolvedValue([]);
    vi.mocked(hasCompletedCohort).mockReset().mockResolvedValue(false);
  });

  const cases: Array<{
    name: string;
    expectedState: StudentJourneyState;
    applications?: Application[];
    profile?: { id: string; status: "DRAFT" | "PUBLISHED" | "SUSPENDED" };
    accessible?: boolean;
    completed?: boolean;
    unread?: number;
    expectedTitle: string;
    expectedAction: string;
  }> = [
    {
      name: "new sign-in",
      expectedState: "no_application",
      expectedTitle: "Apply to Builders Cohort",
      expectedAction: "/dashboard/apply",
    },
    {
      name: "pending applicant",
      expectedState: "pending",
      applications: [application("PENDING")],
      expectedTitle: "Your application is with the team",
      expectedAction: "/dashboard/application/application-pending",
    },
    {
      name: "audit participant",
      expectedState: "audit",
      applications: [application("AUDIT")],
      accessible: true,
      expectedTitle: "Keep learning with the cohort",
      expectedAction: "/dashboard/sessions",
    },
    {
      name: "rejected applicant",
      expectedState: "rejected",
      applications: [application("REJECTED")],
      expectedTitle: "Keep building with the community",
      expectedAction: "/dashboard/apply",
    },
    {
      name: "accepted student",
      expectedState: "accepted",
      applications: [application("APPROVED")],
      accessible: true,
      expectedTitle: "Start with your cohort sessions",
      expectedAction: "/dashboard/sessions",
    },
    {
      name: "graduate",
      expectedState: "completed",
      applications: [application("COMPLETED", START_DATE)],
      accessible: true,
      completed: true,
      expectedTitle: "Your certificate is ready",
      expectedAction: "/certificate/application-completed",
    },
    {
      name: "published builder",
      expectedState: "published",
      applications: [application("COMPLETED", START_DATE)],
      profile: { id: "profile-1", status: "PUBLISHED" },
      accessible: true,
      completed: true,
      unread: 2,
      expectedTitle: "Your builder profile is live",
      expectedAction: "/dashboard/leads",
    },
  ];

  for (const testCase of cases) {
    it(`derives the ${testCase.name} state and one next step`, async () => {
      vi.mocked(getAccessibleProgramIds).mockResolvedValue(
        testCase.accessible ? ["program-1"] : []
      );
      vi.mocked(hasCompletedCohort).mockResolvedValue(
        testCase.completed ?? false
      );
      const db = createDatabase({
        applications: testCase.applications,
        profile: testCase.profile,
        unreadLeadCount: testCase.unread,
      });

      const journey = await getStudentJourney(db, "student-1");

      expect(journey.state).toBe(testCase.expectedState);
      expect(journey.nextStep.title).toBe(testCase.expectedTitle);
      expect(journey.nextStep.action.href).toBe(testCase.expectedAction);
      expect(journey.visibleLinkIds).toEqual(
        expect.arrayContaining(["home", "apply", "ask", "account", "logout"])
      );
      expect(journey.visibleLinkIds.includes("sessions")).toBe(
        testCase.accessible ?? false
      );
    });
  }

  it("uses the existing completion and recording-access helpers", async () => {
    const db = createDatabase({});

    await getStudentJourney(db, "student-42");

    expect(getAccessibleProgramIds).toHaveBeenCalledWith(db, "student-42");
    expect(hasCompletedCohort).toHaveBeenCalledWith(db, "student-42");
  });

  it("shows profile tools only when their current gates pass", async () => {
    vi.mocked(getAccessibleProgramIds).mockResolvedValue(["program-1"]);
    vi.mocked(hasCompletedCohort).mockResolvedValue(true);

    const graduate = await getStudentJourney(
      createDatabase({
        applications: [application("COMPLETED", START_DATE)],
        profile: { id: "profile-1", status: "DRAFT" },
      }),
      "graduate-1"
    );
    expect(graduate.visibleLinkIds).toContain("profile");
    expect(graduate.visibleLinkIds).toContain("leads");
    expect(graduate.visibleLinkIds).not.toContain("writing");
    expect(graduate.visibleLinkIds).not.toContain("opportunities");

    const published = await getStudentJourney(
      createDatabase({
        applications: [application("COMPLETED", START_DATE)],
        profile: { id: "profile-1", status: "PUBLISHED" },
        unreadLeadCount: 3,
      }),
      "graduate-1"
    );
    expect(published.visibleLinkIds).toEqual(
      expect.arrayContaining(["profile", "writing", "opportunities", "leads"])
    );
    expect(published.unreadLeadCount).toBe(3);
  });

  it("does not treat a legacy completion without a date as graduation", async () => {
    vi.mocked(getAccessibleProgramIds).mockResolvedValue(["program-1"]);
    const journey = await getStudentJourney(
      createDatabase({ applications: [application("COMPLETED")] }),
      "student-1"
    );

    expect(journey.state).toBe("accepted");
    expect(journey.visibleLinkIds).not.toContain("profile");
  });

  it("formats dates without an ambiguous numeric month", () => {
    expect(formatJourneyDate(START_DATE)).toBe("Oct 6, 2026");
  });
});
