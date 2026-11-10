/**
 * The fictional people a SAM agent may sign in as on staging. Each is a synthetic account that
 * only this mechanism creates (ids under SAM_PERSONA_PREFIX, emails under @invalid.ttv); no real
 * account can be chosen. Signing in seeds the persona again, so its roles and cohort status are
 * what the table below says, while what it did in the app (posts, profile edits, onboarding)
 * carries over between logins. `newcomer` is a brand-new account every time.
 */
export const SAM_PERSONA_PREFIX = "ttv-sam-persona-";

type Role = "ADMIN" | "MENTOR" | "INSTITUTION";
type Cohort = "past" | "current" | "next";
type Intent = "MEMBER" | "MENTOR" | "INSTITUTION";

interface PersonaDefinition {
  name: string;
  /** Who this is, for the login script's output. */
  summary: string;
  role?: Role;
  application?: {
    cohort: Cohort;
    status: "PENDING" | "APPROVED" | "COMPLETED";
  };
  intent?: Intent;
}

export const SAM_PERSONAS = {
  newcomer: {
    name: "Brian Kiprono",
    summary: "A brand-new account that has not finished onboarding",
  },
  applicant: {
    name: "Njeri Wambui",
    summary: "Applied to the next cohort; waiting for a decision",
    application: { cohort: "next", status: "PENDING" },
    intent: "MEMBER",
  },
  student: {
    name: "Wanjiku Mwangi",
    summary: "Accepted into the current cohort",
    application: { cohort: "current", status: "APPROVED" },
    intent: "MEMBER",
  },
  alumna: {
    name: "Achieng Otieno",
    summary: "Completed a past cohort, with a saved community profile",
    application: { cohort: "past", status: "COMPLETED" },
    intent: "MEMBER",
  },
  community: {
    name: "Lucy Chebet",
    summary: "A community member who is not in a cohort",
    intent: "MEMBER",
  },
  mentor: {
    name: "David Kamau",
    summary: "An approved, listed mentor",
    role: "MENTOR",
    intent: "MENTOR",
  },
  institution: {
    name: "Joseph Mutua",
    summary: "An approved institution account",
    role: "INSTITUTION",
    intent: "INSTITUTION",
  },
  admin: { name: "Amina Hassan", summary: "A staging admin", role: "ADMIN" },
} as const satisfies Record<string, PersonaDefinition>;

export type SamPersona = keyof typeof SAM_PERSONAS;
export const SAM_PERSONA_KEYS = Object.keys(SAM_PERSONAS) as SamPersona[];

export function samPersona(value: unknown): SamPersona | null {
  return typeof value === "string" && Object.hasOwn(SAM_PERSONAS, value)
    ? (value as SamPersona)
    : null;
}

export const samPersonaEmail = (userId: string) => `${userId}@invalid.ttv`;

/** The account a login uses: the persona's own, or for a newcomer a fresh one named by `suffix`. */
export function samPersonaUserId(persona: SamPersona, suffix: string): string {
  return persona === "newcomer"
    ? `${SAM_PERSONA_PREFIX}newcomer-${suffix}`
    : `${SAM_PERSONA_PREFIX}${persona}`;
}

/** Whether an account id is one this mechanism owns. */
export function isSamPersonaUserId(userId: string): boolean {
  return userId.startsWith(SAM_PERSONA_PREFIX);
}

const CURRICULUM_ID = `${SAM_PERSONA_PREFIX}curriculum`;
const DAY = 86_400;
/** Three fictional cohorts around today, so "past", "current" and "next" stay true as time passes. */
const COHORTS: Record<
  Cohort,
  { id: string; name: string; start: number; end: number; open: 0 | 1 }
> = {
  past: {
    id: `${SAM_PERSONA_PREFIX}cohort-past`,
    name: "Cohort 90 (fictional)",
    start: -300,
    end: -120,
    open: 0,
  },
  current: {
    id: `${SAM_PERSONA_PREFIX}cohort-current`,
    name: "Cohort 91 (fictional)",
    start: -60,
    end: 60,
    open: 0,
  },
  next: {
    id: `${SAM_PERSONA_PREFIX}cohort-next`,
    name: "Cohort 92 (fictional)",
    start: 90,
    end: 270,
    open: 1,
  },
};

function cohortStatements(db: D1Database, now: number): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO curriculum (id,title,description,createdAt,updatedAt) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        CURRICULUM_ID,
        "Full-stack foundations (fictional)",
        "Fictional curriculum for SAM staging personas.",
        now,
        now,
      ),
    // An upsert, never INSERT OR REPLACE: replacing a program deletes it, and that cascades to its cohort channels.
    ...Object.values(COHORTS).map((cohort) =>
      db
        .prepare(
          `INSERT INTO program (id,name,description,curriculumId,startDate,endDate,applicationsOpen,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET startDate=excluded.startDate, endDate=excluded.endDate, applicationsOpen=excluded.applicationsOpen`,
        )
        .bind(
          cohort.id,
          cohort.name,
          "Fictional cohort for SAM staging personas.",
          CURRICULUM_ID,
          now + cohort.start * DAY,
          now + cohort.end * DAY,
          cohort.open,
          now,
          now,
        ),
    ),
  ];
}

/** Idempotent writes that make `userId` the persona the table describes. */
export function samPersonaStatements(
  db: D1Database,
  persona: SamPersona,
  userId: string,
  now: number,
): D1PreparedStatement[] {
  const definition: PersonaDefinition = SAM_PERSONAS[persona];
  const nowMs = now * 1000;
  const statements = [
    ...cohortStatements(db, now),
    db
      .prepare(
        `INSERT INTO "user" (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES (?,?,?,1,NULL,?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(userId, definition.name, samPersonaEmail(userId), now, now),
    // Roles are reset on every login: an admin persona may have granted or removed one since.
    db.prepare(`DELETE FROM UserRoles WHERE userId=?`).bind(userId),
  ];
  if (definition.role) {
    statements.push(
      db
        .prepare(
          `INSERT INTO UserRoles (id,userId,roleId,createdAt,updatedAt) SELECT ?,?,id,?,? FROM Roles WHERE name=?`,
        )
        .bind(`${userId}-role`, userId, now, now, definition.role),
    );
  }
  statements.push(
    persona === "newcomer"
      ? db
          .prepare(
            `INSERT INTO member_onboarding (userId,stage,completedAt,promptDismissedAt,createdAt,updatedAt) VALUES (?,'NEW',NULL,NULL,?,?) ON CONFLICT(userId) DO NOTHING`,
          )
          .bind(userId, nowMs, nowMs)
      : db
          .prepare(
            `INSERT INTO member_onboarding (userId,stage,completedAt,promptDismissedAt,createdAt,updatedAt) VALUES (?,'DONE',?,NULL,?,?) ON CONFLICT(userId) DO NOTHING`,
          )
          .bind(userId, nowMs, nowMs, nowMs),
  );
  if (definition.intent) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO member_intent (userId,intent,createdAt) VALUES (?,?,?)`,
        )
        .bind(userId, definition.intent, nowMs),
    );
  }
  if (definition.application) {
    const { cohort, status } = definition.application;
    const submission = JSON.stringify({
      version: "1",
      name: definition.name,
      partnerId: "",
      submission: [
        { type: "string", name: "name", label: "Name", value: definition.name },
      ],
    });
    statements.push(
      db
        .prepare(
          `INSERT INTO programApplication (id,programId,userId,status,application,completedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET programId=excluded.programId, status=excluded.status, completedAt=excluded.completedAt, updatedAt=excluded.updatedAt`,
        )
        .bind(
          `${userId}-application`,
          COHORTS[cohort].id,
          userId,
          status,
          submission,
          status === "COMPLETED" ? now + COHORTS[cohort].end * DAY : null,
          now,
          now,
        ),
    );
  }
  if (persona === "alumna") {
    statements.push(
      db
        .prepare(
          `INSERT INTO studentProfile (id,userId,handle,headline,bio,skills,opportunityGoals,contentVersion,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,1,?,?) ON CONFLICT(userId) DO NOTHING`,
        )
        .bind(
          `${userId}-profile`,
          userId,
          `sam-${userId.slice(-24)}`,
          "Backend builder",
          "Fictional SAM persona. I build payment and ledger tools for small groups.",
          JSON.stringify(["TypeScript", "SQL"]),
          "A backend developer role",
          now,
          now,
        ),
    );
  }
  if (persona === "mentor") {
    statements.push(
      db
        .prepare(
          `INSERT INTO mentor_profile (userId,headline,bio,areas,formats,monthlyCapacity,paused,createdAt,updatedAt) VALUES (?,?,?,?,?,3,0,?,?) ON CONFLICT(userId) DO NOTHING`,
        )
        .bind(
          userId,
          "Backend engineer · fintech",
          "Fictional SAM persona. Reviews APIs and data models.",
          JSON.stringify(["Code review", "API design"]),
          JSON.stringify(["WRITTEN_REVIEW", "CALL_30_MIN"]),
          nowMs,
          nowMs,
        ),
    );
  }
  return statements;
}
