import { CONDUCT_VERSION } from "@/lib/channels/conduct";

/**
 * The fictional people a SAM agent may sign in as on staging. Each is a synthetic account that
 * only this mechanism creates (ids under SAM_PERSONA_PREFIX, emails under @invalid.ttv); no real
 * account can be chosen. Signing in seeds the persona again, so its roles, cohort status and cohort
 * role are what the table below says, while what it did in the app (posts, profile edits,
 * onboarding) carries over between logins. `newcomer` is a brand-new account every time.
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
  application?: { cohort: Cohort; status: "PENDING" | "APPROVED" | "COMPLETED" };
  /** A role in one fictional cohort: a TA hosts that cohort's sessions. */
  cohortRole?: { cohort: Cohort; name: "TA" };
  intent?: Intent;
  /** A saved member profile; its bio always begins "Fictional SAM persona." */
  profile?: { headline: string; bio: string; skills: string[]; goals: string };
  /**
   * Agreed to the channels' code of conduct when seeded, so a call or a post isn't held at the
   * agreement (the call personas, for rooms of up to 15 people). The others agree in the app.
   */
  conduct?: true;
}

/** One of the current cohort's fictional classmates, there to fill a call (in-app calls T1). */
const classmate = (name: string, headline: string, bio: string, skills: string[]) => ({
  name,
  summary: "Accepted into the current cohort; agreed to the code of conduct",
  application: { cohort: "current", status: "APPROVED" },
  intent: "MEMBER",
  profile: { headline, bio: `Fictional SAM persona. ${bio}`, skills, goals: "A first developer role" },
  conduct: true,
}) as const satisfies PersonaDefinition;

export const SAM_PERSONAS = {
  newcomer: { name: "Brian Kiprono", summary: "A brand-new account that has not finished onboarding" },
  applicant: { name: "Njeri Wambui", summary: "Applied to the next cohort; waiting for a decision", application: { cohort: "next", status: "PENDING" }, intent: "MEMBER" },
  student: { name: "Wanjiku Mwangi", summary: "Accepted into the current cohort", application: { cohort: "current", status: "APPROVED" }, intent: "MEMBER" },
  alumna: {
    name: "Achieng Otieno", summary: "Completed a past cohort, with a saved profile", application: { cohort: "past", status: "COMPLETED" }, intent: "MEMBER",
    profile: { headline: "Backend builder", bio: "Fictional SAM persona. I build payment and ledger tools for small groups.", skills: ["TypeScript", "SQL"], goals: "A backend developer role" },
  },
  community: { name: "Lucy Chebet", summary: "A community member who is not in a cohort", intent: "MEMBER" },
  mentor: { name: "David Kamau", summary: "An approved, listed mentor", role: "MENTOR", intent: "MENTOR" },
  institution: { name: "Joseph Mutua", summary: "An approved institution account", role: "INSTITUTION", intent: "INSTITUTION" },
  admin: { name: "Amina Hassan", summary: "A staging admin", role: "ADMIN" },
  // The call personas (in-app calls T1): with `student`, `ta` and `admin`, ten people who all read
  // the current cohort's channel; with everyone else signed in, a full community room of 15 and one more.
  classmate1: classmate("Mwende Kilonzo", "Frontend builder", "I make forms that work on slow phones.", ["HTML", "CSS"]),
  classmate2: classmate("Onyango Okoth", "Backend builder", "I write small APIs for shop inventories.", ["Node.js", "SQL"]),
  classmate3: classmate("Chepkoech Rotich", "Mobile builder", "I build offline-first apps for farm records.", ["Kotlin"]),
  classmate4: classmate("Nyambura Gitau", "Data builder", "I clean and chart savings group data.", ["Python", "SQL"]),
  classmate5: classmate("Wekesa Barasa", "Full-stack builder", "I build booking pages for small clinics.", ["TypeScript", "React"]),
  classmate6: classmate("Akinyi Owino", "Frontend builder", "I care about pages that read well on any screen.", ["React", "Accessibility"]),
  classmate7: classmate("Mutiso Ndambuki", "Backend builder", "I build SMS reminders for chama contributions.", ["Go", "SQL"]),
  ta: {
    name: "Zawadi Njoroge",
    summary: "A TA in the current cohort, who hosts its sessions; agreed to the code of conduct",
    cohortRole: { cohort: "current", name: "TA" },
    intent: "MEMBER",
    profile: { headline: "Teaching assistant", bio: "Fictional SAM persona. I help the current cohort with reviews and pairing.", skills: ["TypeScript", "Testing"], goals: "Mentoring new developers" },
    conduct: true,
  },
} as const satisfies Record<string, PersonaDefinition>;

export type SamPersona = keyof typeof SAM_PERSONAS;
export const SAM_PERSONA_KEYS = Object.keys(SAM_PERSONAS) as SamPersona[];

export function samPersona(value: unknown): SamPersona | null {
  return typeof value === "string" && Object.hasOwn(SAM_PERSONAS, value) ? (value as SamPersona) : null;
}

export const samPersonaEmail = (userId: string) => `${userId}@invalid.ttv`;

/** The account a login uses: the persona's own, or for a newcomer a fresh one named by `suffix`. */
export function samPersonaUserId(persona: SamPersona, suffix: string): string {
  return persona === "newcomer" ? `${SAM_PERSONA_PREFIX}newcomer-${suffix}` : `${SAM_PERSONA_PREFIX}${persona}`;
}

/** Whether an account id is one this mechanism owns. */
export function isSamPersonaUserId(userId: string): boolean {
  return userId.startsWith(SAM_PERSONA_PREFIX);
}

const CURRICULUM_ID = `${SAM_PERSONA_PREFIX}curriculum`;
const DAY = 86_400;
/** Three fictional cohorts around today, so "past", "current" and "next" stay true as time passes. */
const COHORTS: Record<Cohort, { id: string; name: string; start: number; end: number; open: 0 | 1 }> = {
  past: { id: `${SAM_PERSONA_PREFIX}cohort-past`, name: "Cohort 90 (fictional)", start: -300, end: -120, open: 0 },
  current: { id: `${SAM_PERSONA_PREFIX}cohort-current`, name: "Cohort 91 (fictional)", start: -60, end: 60, open: 0 },
  next: { id: `${SAM_PERSONA_PREFIX}cohort-next`, name: "Cohort 92 (fictional)", start: 90, end: 270, open: 1 },
};

function cohortStatements(db: D1Database, now: number): D1PreparedStatement[] {
  return [
    db.prepare(`INSERT INTO curriculum (id,title,description,createdAt,updatedAt) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(CURRICULUM_ID, "Full-stack foundations (fictional)", "Fictional curriculum for SAM staging personas.", now, now),
    // An upsert, never INSERT OR REPLACE: replacing a program deletes it, and that cascades to its cohort channels.
    ...Object.values(COHORTS).map((cohort) => db.prepare(
      `INSERT INTO program (id,name,description,curriculumId,startDate,endDate,applicationsOpen,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET startDate=excluded.startDate, endDate=excluded.endDate, applicationsOpen=excluded.applicationsOpen`,
    ).bind(cohort.id, cohort.name, "Fictional cohort for SAM staging personas.", CURRICULUM_ID,
      now + cohort.start * DAY, now + cohort.end * DAY, cohort.open, now, now)),
  ];
}

/** Idempotent writes that make `userId` the persona the table describes. */
export function samPersonaStatements(db: D1Database, persona: SamPersona, userId: string, now: number): D1PreparedStatement[] {
  const definition: PersonaDefinition = SAM_PERSONAS[persona];
  const nowMs = now * 1000;
  const statements = [
    ...cohortStatements(db, now),
    db.prepare(`INSERT INTO "user" (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES (?,?,?,1,NULL,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(userId, definition.name, samPersonaEmail(userId), now, now),
    // Roles are reset on every login: an admin persona may have granted or removed one since.
    db.prepare(`DELETE FROM UserRoles WHERE userId=?`).bind(userId),
  ];
  if (definition.role) {
    statements.push(db.prepare(`INSERT INTO UserRoles (id,userId,roleId,createdAt,updatedAt) SELECT ?,?,id,?,? FROM Roles WHERE name=?`)
      .bind(`${userId}-role`, userId, now, now, definition.role));
  }
  statements.push(persona === "newcomer"
    ? db.prepare(`INSERT INTO member_onboarding (userId,stage,completedAt,promptDismissedAt,createdAt,updatedAt) VALUES (?,'NEW',NULL,NULL,?,?) ON CONFLICT(userId) DO NOTHING`)
      .bind(userId, nowMs, nowMs)
    : db.prepare(`INSERT INTO member_onboarding (userId,stage,completedAt,promptDismissedAt,createdAt,updatedAt) VALUES (?,'DONE',?,NULL,?,?) ON CONFLICT(userId) DO NOTHING`)
      .bind(userId, nowMs, nowMs, nowMs));
  if (definition.intent) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO member_intent (userId,intent,createdAt) VALUES (?,?,?)`).bind(userId, definition.intent, nowMs));
  }
  if (definition.application) {
    const { cohort, status } = definition.application;
    const submission = JSON.stringify({ version: "1", name: definition.name, partnerId: "", submission: [{ type: "string", name: "name", label: "Name", value: definition.name }] });
    statements.push(db.prepare(
      `INSERT INTO programApplication (id,programId,userId,status,application,completedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET programId=excluded.programId, status=excluded.status, completedAt=excluded.completedAt, updatedAt=excluded.updatedAt`,
    ).bind(`${userId}-application`, COHORTS[cohort].id, userId, status, submission,
      status === "COMPLETED" ? now + COHORTS[cohort].end * DAY : null, now, now));
  }
  // Cohort roles are reset on every login too, like the global roles above.
  statements.push(db.prepare(`DELETE FROM programRole WHERE userId=?`).bind(userId));
  if (definition.cohortRole) {
    statements.push(db.prepare(`INSERT INTO programRole (id,programId,userId,name,createdAt,updatedAt) VALUES (?,?,?,?,?,?)`)
      .bind(`${userId}-cohort-role`, COHORTS[definition.cohortRole.cohort].id, userId, definition.cohortRole.name, now, now));
  }
  if (definition.profile) {
    // Seeded once and then the persona's own: profile edits carry over between logins.
    const { headline, bio, skills, goals } = definition.profile;
    statements.push(db.prepare(`INSERT INTO studentProfile (id,userId,handle,headline,bio,skills,opportunityGoals,contentVersion,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,1,?,?) ON CONFLICT(userId) DO NOTHING`)
      .bind(`${userId}-profile`, userId, `sam-persona-${persona}`, headline, bio, JSON.stringify(skills), goals, now, now));
  }
  if (definition.conduct) {
    // An agreement never moves backwards, and keeps its date unless the version is newer (channels/conduct.ts).
    statements.push(db.prepare(`INSERT INTO channel_conduct (userId,version,acknowledgedAt) VALUES (?,?,?)
       ON CONFLICT(userId) DO UPDATE SET
         acknowledgedAt = CASE WHEN excluded.version > version THEN excluded.acknowledgedAt ELSE acknowledgedAt END,
         version = max(version, excluded.version)`).bind(userId, CONDUCT_VERSION, nowMs));
  }
  if (persona === "mentor") {
    statements.push(db.prepare(`INSERT INTO mentor_profile (userId,headline,bio,areas,formats,monthlyCapacity,paused,createdAt,updatedAt) VALUES (?,?,?,?,?,3,0,?,?) ON CONFLICT(userId) DO NOTHING`)
      .bind(userId, "Backend engineer · fintech", "Fictional SAM persona. Reviews APIs and data models.", JSON.stringify(["Code review", "API design"]), JSON.stringify(["WRITTEN_REVIEW", "CALL_30_MIN"]), nowMs, nowMs));
  }
  return statements;
}
