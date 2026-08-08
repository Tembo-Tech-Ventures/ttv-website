import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { drizzle } from "drizzle-orm/d1";

export type Database = ReturnType<typeof drizzle<typeof import("@/lib/db/schema")>>;

// ─── Helpers ───────────────────────────────────────────────

const cuid = (name: string) =>
  text(name)
    .primaryKey()
    .$defaultFn(() => createId());

const timestamps = {
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdateFn(() => new Date()),
};

// ─── User (matches better-auth expected schema) ────────────

export const user = sqliteTable("user", {
  id: cuid("id"),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const userRelations = relations(user, ({ many, one }) => ({
  accounts: many(account),
  sessions: many(session),
  userRoles: many(userRole),
  files: many(file),
  programRoles: many(programRole),
  programApplications: many(programApplication),
  chatMessages: many(chatMessage),
  studentProfile: one(studentProfile),
}));

// ─── Account (matches better-auth expected schema) ─────────

export const account = sqliteTable("account", {
  id: cuid("id"),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps,
});

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

// ─── Session (matches better-auth expected schema) ─────────

export const session = sqliteTable("session", {
  id: cuid("id"),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  ...timestamps,
});

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

// ─── Verification (matches better-auth expected schema) ───

export const verification = sqliteTable("verification", {
  id: cuid("id"),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  ...timestamps,
});

// ─── Role ──────────────────────────────────────────────────

export const role = sqliteTable("Roles", {
  id: cuid("id"),
  name: text("name").notNull().unique(),
  ...timestamps,
});

export const roleRelations = relations(role, ({ many }) => ({
  userRoles: many(userRole),
}));

// ─── UserRole ──────────────────────────────────────────────

export const userRole = sqliteTable(
  "UserRoles",
  {
    id: cuid("id"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: text("roleId")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("UserRoles_userId_roleId_unique").on(table.userId, table.roleId),
  ]
);

export const userRoleRelations = relations(userRole, ({ one }) => ({
  user: one(user, { fields: [userRole.userId], references: [user.id] }),
  role: one(role, { fields: [userRole.roleId], references: [role.id] }),
}));

// ─── File ──────────────────────────────────────────────────

export const file = sqliteTable("file", {
  id: cuid("id"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  ownerId: text("ownerId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  ...timestamps,
});

export const fileRelations = relations(file, ({ one }) => ({
  owner: one(user, { fields: [file.ownerId], references: [user.id] }),
}));

// ─── Curriculum ────────────────────────────────────────────

export const curriculum = sqliteTable("curriculum", {
  id: cuid("id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  ...timestamps,
});

export const curriculumRelations = relations(curriculum, ({ many }) => ({
  programs: many(program),
}));

// ─── Program ───────────────────────────────────────────────

export const program = sqliteTable("program", {
  id: cuid("id"),
  name: text("name").notNull(),
  description: text("description").notNull(),
  curriculumId: text("curriculumId")
    .notNull()
    .references(() => curriculum.id),
  startDate: integer("startDate", { mode: "timestamp" }),
  endDate: integer("endDate", { mode: "timestamp" }),
  applicationsOpen: integer("applicationsOpen", { mode: "boolean" })
    .notNull()
    .default(false),
  ...timestamps,
});

export const programRelations = relations(program, ({ one, many }) => ({
  curriculum: one(curriculum, {
    fields: [program.curriculumId],
    references: [curriculum.id],
  }),
  programRoles: many(programRole),
  programApplications: many(programApplication),
  recordings: many(recording),
}));

// ─── ProgramRole ───────────────────────────────────────────

export const programRole = sqliteTable(
  "programRole",
  {
    id: cuid("id"),
    programId: text("programId")
      .notNull()
      .references(() => program.id),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
    name: text("name", { enum: ["INSTRUCTOR", "TA"] }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("programRole_programId_userId_name_unique").on(
      table.programId,
      table.userId,
      table.name
    ),
  ]
);

export const programRoleRelations = relations(programRole, ({ one }) => ({
  program: one(program, {
    fields: [programRole.programId],
    references: [program.id],
  }),
  user: one(user, { fields: [programRole.userId], references: [user.id] }),
}));

// ─── ProgramPartner ────────────────────────────────────────

export const programPartner = sqliteTable("programPartner", {
  id: cuid("id"),
  name: text("name").notNull(),
  ...timestamps,
});

export const programPartnerRelations = relations(programPartner, ({ many }) => ({
  programApplications: many(programApplication),
}));

// ─── ProgramApplication ────────────────────────────────────

export const programApplication = sqliteTable(
  "programApplication",
  {
    id: cuid("id"),
    programId: text("programId").references(() => program.id),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    partnerId: text("partnerId").references(() => programPartner.id),
    status: text("status", {
      enum: ["PENDING", "APPROVED", "REJECTED", "AUDIT", "COMPLETED"],
    })
      .notNull()
      .default("PENDING"),
    application: text("application").notNull(),
    completedAt: integer("completedAt", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("programApplication_programId_userId_unique").on(
      table.programId,
      table.userId
    ),
  ]
);

export const programApplicationRelations = relations(
  programApplication,
  ({ one }) => ({
    program: one(program, {
      fields: [programApplication.programId],
      references: [program.id],
    }),
    user: one(user, {
      fields: [programApplication.userId],
      references: [user.id],
    }),
    partner: one(programPartner, {
      fields: [programApplication.partnerId],
      references: [programPartner.id],
    }),
  })
);

// ─── Recording ─────────────────────────────────────────────

export const recording = sqliteTable("recording", {
  id: cuid("id"),
  programId: text("programId").references(() => program.id),
  title: text("title").notNull(),
  description: text("description"),
  driveFileId: text("driveFileId"),
  r2VideoKey: text("r2VideoKey"),
  r2AudioKey: text("r2AudioKey"),
  durationSeconds: integer("durationSeconds"),
  fileSizeBytes: integer("fileSizeBytes"),
  recordedAt: integer("recordedAt", { mode: "timestamp" }),
  processingStatus: text("processingStatus", {
    enum: [
      "pending",
      "queued",
      "extracting_audio",
      "transcribing",
      "embedding",
      "complete",
      "failed",
    ],
  })
    .notNull()
    .default("pending"),
  processingError: text("processingError"),
  transcriptText: text("transcriptText"),
  transcriptVtt: text("transcriptVtt"),
  ...timestamps,
});

export const recordingRelations = relations(recording, ({ one, many }) => ({
  program: one(program, {
    fields: [recording.programId],
    references: [program.id],
  }),
  segments: many(transcriptSegment),
}));

// ─── TranscriptSegment ─────────────────────────────────────

export const transcriptSegment = sqliteTable("transcript_segment", {
  id: cuid("id"),
  recordingId: text("recordingId")
    .notNull()
    .references(() => recording.id, { onDelete: "cascade" }),
  startTime: real("startTime").notNull(),
  endTime: real("endTime").notNull(),
  speaker: text("speaker"),
  text: text("text").notNull(),
  chunkIndex: integer("chunkIndex"),
  vectorId: text("vectorId"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const transcriptSegmentRelations = relations(
  transcriptSegment,
  ({ one }) => ({
    recording: one(recording, {
      fields: [transcriptSegment.recordingId],
      references: [recording.id],
    }),
  })
);

// ─── ChatMessage ───────────────────────────────────────────

export const chatMessage = sqliteTable("chat_message", {
  id: cuid("id"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  citations: text("citations"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const chatMessageRelations = relations(chatMessage, ({ one }) => ({
  user: one(user, { fields: [chatMessage.userId], references: [user.id] }),
}));

// ─── StudentProfile ───────────────────────────────────────

export const studentProfile = sqliteTable("studentProfile", {
  id: cuid("id"),
  userId: text("userId")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  handle: text("handle").notNull().unique(),
  status: text("status", {
    enum: ["DRAFT", "IN_REVIEW", "PUBLISHED", "SUSPENDED"],
  })
    .notNull()
    .default("DRAFT"),
  headline: text("headline"),
  bio: text("bio"),
  location: text("location"),
  country: text("country"),
  skills: text("skills"),
  openToFreelance: integer("openToFreelance", { mode: "boolean" })
    .notNull()
    .default(false),
  openToRoles: integer("openToRoles", { mode: "boolean" })
    .notNull()
    .default(false),
  githubLogin: text("githubLogin"),
  portfolioUrl: text("portfolioUrl"),
  linkedinUrl: text("linkedinUrl"),
  publishedAt: integer("publishedAt", { mode: "timestamp" }),
  ...timestamps,
});

export const studentProfileRelations = relations(
  studentProfile,
  ({ one, many }) => ({
    user: one(user, {
      fields: [studentProfile.userId],
      references: [user.id],
    }),
    highlights: many(profileHighlight),
    contacts: many(profileContact),
    projectInterests: many(projectInterest),
  })
);

// ─── ProfileHighlight ─────────────────────────────────────

export const profileHighlight = sqliteTable(
  "profileHighlight",
  {
    id: cuid("id"),
    profileId: text("profileId")
      .notNull()
      .references(() => studentProfile.id, { onDelete: "cascade" }),
    repoFullName: text("repoFullName").notNull(),
    repoUrl: text("repoUrl").notNull(),
    description: text("description"),
    language: text("language"),
    topics: text("topics"),
    stars: integer("stars").notNull().default(0),
    pushedAt: integer("pushedAt", { mode: "timestamp" }),
    blurb: text("blurb"),
    sortOrder: integer("sortOrder").notNull().default(0),
    snapshotAt: integer("snapshotAt", { mode: "timestamp" }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("profileHighlight_profileId_repoFullName_unique").on(
      table.profileId,
      table.repoFullName
    ),
  ]
);

export const profileHighlightRelations = relations(
  profileHighlight,
  ({ one }) => ({
    profile: one(studentProfile, {
      fields: [profileHighlight.profileId],
      references: [studentProfile.id],
    }),
  })
);

// ─── ProfileContact ───────────────────────────────────────

export const profileContact = sqliteTable("profileContact", {
  id: cuid("id"),
  profileId: text("profileId")
    .notNull()
    .references(() => studentProfile.id, { onDelete: "cascade" }),
  fromName: text("fromName").notNull(),
  fromEmail: text("fromEmail").notNull(),
  organization: text("organization"),
  message: text("message").notNull(),
  status: text("status", {
    enum: ["NEW", "READ", "ARCHIVED"],
  })
    .notNull()
    .default("NEW"),
  ...timestamps,
});

export const profileContactRelations = relations(
  profileContact,
  ({ one }) => ({
    profile: one(studentProfile, {
      fields: [profileContact.profileId],
      references: [studentProfile.id],
    }),
  })
);

// ─── ClientProject ────────────────────────────────────────

export const clientProject = sqliteTable("clientProject", {
  id: cuid("id"),
  organization: text("organization").notNull(),
  contactName: text("contactName").notNull(),
  contactEmail: text("contactEmail").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  skills: text("skills"),
  budgetBand: text("budgetBand", {
    enum: [
      "UNDER_1K",
      "FROM_1K_TO_5K",
      "FROM_5K_TO_15K",
      "OVER_15K",
      "UNDISCLOSED",
    ],
  })
    .notNull()
    .default("UNDISCLOSED"),
  timeline: text("timeline"),
  status: text("status", {
    enum: ["PENDING", "APPROVED", "REJECTED", "CLOSED", "MATCHED"],
  })
    .notNull()
    .default("PENDING"),
  ...timestamps,
});

export const clientProjectRelations = relations(
  clientProject,
  ({ many }) => ({
    projectInterests: many(projectInterest),
  })
);

// ─── ProjectInterest ──────────────────────────────────────

export const projectInterest = sqliteTable(
  "projectInterest",
  {
    id: cuid("id"),
    projectId: text("projectId")
      .notNull()
      .references(() => clientProject.id, { onDelete: "cascade" }),
    profileId: text("profileId")
      .notNull()
      .references(() => studentProfile.id, { onDelete: "cascade" }),
    note: text("note"),
    status: text("status", {
      enum: ["INTERESTED", "WITHDRAWN"],
    })
      .notNull()
      .default("INTERESTED"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("projectInterest_projectId_profileId_unique").on(
      table.projectId,
      table.profileId
    ),
  ]
);

export const projectInterestRelations = relations(
  projectInterest,
  ({ one }) => ({
    project: one(clientProject, {
      fields: [projectInterest.projectId],
      references: [clientProject.id],
    }),
    profile: one(studentProfile, {
      fields: [projectInterest.profileId],
      references: [studentProfile.id],
    }),
  })
);

// ─── IntegrationCredential ────────────────────────────────

export const integrationCredential = sqliteTable("integrationCredential", {
  id: cuid("id"),
  provider: text("provider").notNull().unique(),
  ciphertext: text("ciphertext").notNull(),
  displayMetadata: text("displayMetadata"),
  config: text("config"),
  updatedByUserId: text("updatedByUserId").references(() => user.id, {
    onDelete: "set null",
  }),
  ...timestamps,
});

// ─── CredentialAuditLog ──────────────────────────────────

export const credentialAuditLog = sqliteTable("credentialAuditLog", {
  id: cuid("id"),
  provider: text("provider").notNull(),
  action: text("action", {
    enum: ["set", "replace", "update-config", "remove", "test"],
  }).notNull(),
  outcome: text("outcome"),
  actorUserId: text("actorUserId").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ─── FormSubmissionLog ────────────────────────────────────

export const formSubmissionLog = sqliteTable(
  "formSubmissionLog",
  {
    id: cuid("id"),
    scope: text("scope").notNull(),
    ipHash: text("ipHash").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("formSubmissionLog_scope_ipHash_createdAt_idx").on(
      table.scope,
      table.ipHash,
      table.createdAt
    ),
  ]
);
