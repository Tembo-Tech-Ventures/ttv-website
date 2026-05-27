import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
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

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  sessions: many(session),
  userRoles: many(userRole),
  files: many(file),
  programRoles: many(programRole),
  programApplications: many(programApplication),
  chatMessages: many(chatMessage),
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

export const userRole = sqliteTable("UserRoles", {
  id: cuid("id"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  roleId: text("roleId")
    .notNull()
    .references(() => role.id, { onDelete: "cascade" }),
  ...timestamps,
});

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

export const programRole = sqliteTable("programRole", {
  id: cuid("id"),
  programId: text("programId")
    .notNull()
    .references(() => program.id),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  name: text("name", { enum: ["INSTRUCTOR", "TA"] }).notNull(),
  ...timestamps,
});

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

export const programApplication = sqliteTable("programApplication", {
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
});

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
