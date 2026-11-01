import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { drizzle } from "drizzle-orm/d1";

export type Database = ReturnType<
  typeof drizzle<typeof import("@/lib/db/schema")>
>;

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
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  ...timestamps,
});

export const userRelations = relations(user, ({ many, one }) => ({
  accounts: many(account),
  sessions: many(session),
  personalAccessTokens: many(personalAccessToken),
  userRoles: many(userRole),
  files: many(file),
  programRoles: many(programRole),
  programApplications: many(programApplication),
  chatSessions: many(chatSession),
  chatMessages: many(chatMessage),
  studentProfile: one(studentProfile),
}));

// ─── Platform rollout flags ──────────────────────────────

export const featureFlag = sqliteTable(
  "feature_flag",
  {
    key: text("key").primaryKey(),
    audience: text("audience", { enum: ["OFF", "STAFF", "ALL"] })
      .notNull()
      .default("OFF"),
    updatedAt: timestamps.updatedAt,
    updatedBy: text("updatedBy").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    check("feature_flag_audience_check", sql`${table.audience} IN ('OFF', 'STAFF', 'ALL')`),
  ]
);

// ─── Onboarding (src/lib/onboarding/README.md) ─────────────
// Timestamps are epoch milliseconds, like attention, and are written by the
// domain. Intents choose routing and copy only; capabilitiesFor never reads them.

export const memberIntent = sqliteTable("member_intent", {
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  intent: text("intent", { enum: ["MEMBER", "MENTOR", "INSTITUTION", "EXPLORING"] }).notNull(),
  createdAt: integer("createdAt").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.intent] }),
  check("member_intent_intent_check", sql`${table.intent} IN ('MEMBER','MENTOR','INSTITUTION','EXPLORING')`),
  check("member_intent_time_check", sql`${table.createdAt} >= 0`),
]);

/** NEW only for accounts created while onboarding is open; no row means an account from before rollout. */
export const memberOnboarding = sqliteTable("member_onboarding", {
  userId: text("userId").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["NEW", "DONE"] }).notNull(),
  completedAt: integer("completedAt"),
  promptDismissedAt: integer("promptDismissedAt"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
}, (table) => [
  check("member_onboarding_stage_check", sql`${table.stage} IN ('NEW','DONE')`),
  check("member_onboarding_done_check", sql`${table.stage} = 'DONE' OR (${table.completedAt} IS NULL AND ${table.promptDismissedAt} IS NULL)`),
  check("member_onboarding_time_check", sql`${table.createdAt} >= 0 AND ${table.updatedAt} >= ${table.createdAt}`),
]);

/** A request for a global MENTOR or INSTITUTION role. decidedBy is audit-only and never reaches the requester. */
export const accessRequest = sqliteTable("access_request", {
  id: cuid("id"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["MENTOR", "INSTITUTION"] }).notNull(),
  status: text("status", { enum: ["PENDING", "APPROVED", "DECLINED", "WITHDRAWN"] }).notNull().default("PENDING"),
  note: text("note").notNull(),
  organisation: text("organisation"),
  organisationRole: text("organisationRole"),
  link: text("link"),
  scopeAcknowledgedAt: integer("scopeAcknowledgedAt"),
  decisionId: text("decisionId"),
  /** Set by the withdrawal itself, so the statements batched with it act only for that call. */
  withdrawalId: text("withdrawalId"),
  decisionMessage: text("decisionMessage"),
  decidedBy: text("decidedBy").references(() => user.id, { onDelete: "set null" }),
  decidedAt: integer("decidedAt"),
  requesterSeenAt: integer("requesterSeenAt"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
}, (table) => [
  uniqueIndex("access_request_pending_idx").on(table.userId, table.role).where(sql`${table.status} = 'PENDING'`),
  uniqueIndex("access_request_decision_idx").on(table.decisionId).where(sql`${table.decisionId} IS NOT NULL`),
  index("access_request_queue_idx").on(table.status, table.createdAt),
  index("access_request_user_idx").on(table.userId, table.role, table.createdAt),
  check("access_request_role_check", sql`${table.role} IN ('MENTOR','INSTITUTION')`),
  check("access_request_status_check", sql`${table.status} IN ('PENDING','APPROVED','DECLINED','WITHDRAWN')`),
  check("access_request_note_check", sql`length(trim(${table.note})) >= 20 AND length(${table.note}) <= 600`),
  check("access_request_institution_check", sql`${table.role} <> 'INSTITUTION' OR (${table.organisation} IS NOT NULL AND ${table.scopeAcknowledgedAt} IS NOT NULL)`),
  check("access_request_mentor_check", sql`${table.role} <> 'MENTOR' OR (${table.organisation} IS NULL AND ${table.organisationRole} IS NULL AND ${table.scopeAcknowledgedAt} IS NULL)`),
  check("access_request_organisation_check", sql`${table.organisation} IS NULL OR (length(trim(${table.organisation})) > 0 AND length(${table.organisation}) <= 200)`),
  check("access_request_organisation_role_check", sql`${table.organisationRole} IS NULL OR (length(trim(${table.organisationRole})) > 0 AND length(${table.organisationRole}) <= 200)`),
  check("access_request_link_check", sql`${table.link} IS NULL OR length(${table.link}) <= 2048`),
  check("access_request_decided_check", sql`(${table.status} IN ('APPROVED','DECLINED')) = (${table.decidedAt} IS NOT NULL)`),
  check("access_request_message_check", sql`${table.decisionMessage} IS NULL OR (${table.status} IN ('APPROVED','DECLINED') AND length(trim(${table.decisionMessage})) > 0 AND length(${table.decisionMessage}) <= 600)`),
  check("access_request_withdrawal_check", sql`${table.withdrawalId} IS NULL OR ${table.status} = 'WITHDRAWN'`),
  check("access_request_seen_check", sql`${table.requesterSeenAt} IS NULL OR ${table.status} IN ('APPROVED','DECLINED')`),
  check("access_request_time_check", sql`${table.createdAt} >= 0 AND ${table.updatedAt} >= ${table.createdAt}`),
]);

// ─── Attention ───────────────────────────────────────────

/** Attention timestamps are wire-format epoch milliseconds, not Unix seconds. */
export const attentionItem = sqliteTable("attention_item", {
  id: cuid("id"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  eventKey: text("eventKey").notNull(),
  kind: text("kind").notNull(),
  space: text("space", { enum: ["cohort", "community", "mentoring", "discover", "admin", "profile"] }).notNull(),
  category: text("category", { enum: ["mentions", "requests", "updates"] }).notNull(),
  subjectKind: text("subjectKind").notNull(),
  subjectId: text("subjectId").notNull(),
  subjectHref: text("subjectHref").notNull(),
  subjectLabel: text("subjectLabel").notNull(),
  actorId: text("actorId").references(() => user.id, { onDelete: "set null" }),
  summary: text("summary").notNull(),
  createdAt: integer("createdAt").notNull(),
  readAt: integer("readAt"),
}, table => [
  uniqueIndex("attention_item_user_event_idx").on(table.userId, table.eventKey),
  index("attention_item_unread_idx").on(table.userId, table.readAt, table.space),
  index("attention_item_page_idx").on(table.userId, table.createdAt, table.id),
  index("attention_item_filter_page_idx").on(table.userId, table.category, table.createdAt, table.id),
  check("attention_item_space_check", sql`${table.space} IN ('cohort','community','mentoring','discover','admin','profile')`),
  check("attention_item_category_check", sql`${table.category} IN ('mentions','requests','updates')`),
  check("attention_item_time_check", sql`${table.createdAt} >= 0 AND (${table.readAt} IS NULL OR ${table.readAt} >= ${table.createdAt})`),
]);

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
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp",
  }),
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

// ─── Personal Access Token ─────────────────────────────────

export const personalAccessToken = sqliteTable(
  "personal_access_token",
  {
    id: cuid("id"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull().unique(),
    tokenPrefix: text("tokenPrefix").notNull(),
    label: text("label").notNull(),
    scopes: text("scopes").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    lastUsedAt: integer("lastUsedAt", { mode: "timestamp" }),
    revokedAt: integer("revokedAt", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    index("personal_access_token_userId_idx").on(table.userId),
    index("personal_access_token_expiresAt_idx").on(table.expiresAt),
  ],
);

export const personalAccessTokenRelations = relations(
  personalAccessToken,
  ({ one }) => ({
    user: one(user, {
      fields: [personalAccessToken.userId],
      references: [user.id],
    }),
  }),
);

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
    uniqueIndex("UserRoles_userId_roleId_unique").on(
      table.userId,
      table.roleId,
    ),
  ],
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
  recordingImportSources: many(recordingImportSource),
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
    name: text("name", { enum: ["INSTRUCTOR", "TA", "MENTOR"] }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("programRole_programId_userId_name_unique").on(
      table.programId,
      table.userId,
      table.name,
    ),
    index("programRole_userId_programId_name_idx").on(table.userId, table.programId, table.name),
    check("programRole_name_check", sql`${table.name} IN ('INSTRUCTOR', 'TA', 'MENTOR')`),
  ],
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

export const programPartnerRelations = relations(
  programPartner,
  ({ many }) => ({
    programApplications: many(programApplication),
  }),
);

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
      table.userId,
    ),
    index("programApplication_userId_programId_status_idx").on(table.userId, table.programId, table.status),
  ],
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
  }),
);

// ─── Recording ─────────────────────────────────────────────

export const recording = sqliteTable("recording", {
  id: cuid("id"),
  programId: text("programId").references(() => program.id),
  title: text("title").notNull(),
  description: text("description"),
  driveFileId: text("driveFileId").unique(),
  r2VideoKey: text("r2VideoKey"),
  r2AudioKey: text("r2AudioKey"),
  durationSeconds: integer("durationSeconds"),
  fileSizeBytes: integer("fileSizeBytes"),
  recordedAt: integer("recordedAt", { mode: "timestamp" }),
  processingStatus: text("processingStatus", {
    enum: [
      "pending",
      "queued",
      "downloading",
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
}, (table) => [index("recording_program_idx").on(table.programId)]);

export const recordingRelations = relations(recording, ({ one, many }) => ({
  program: one(program, {
    fields: [recording.programId],
    references: [program.id],
  }),
  segments: many(transcriptSegment),
}));

// ─── RecordingImportSource ─────────────────────────────────

export const recordingImportSource = sqliteTable("recording_import_source", {
  id: cuid("id"),
  programId: text("programId")
    .notNull()
    .references(() => program.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  driveFolderId: text("driveFolderId").notNull(),
  filenameContains: text("filenameContains"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSyncedAt: integer("lastSyncedAt", { mode: "timestamp" }),
  lastError: text("lastError"),
  ...timestamps,
});

export const recordingImportSourceRelations = relations(
  recordingImportSource,
  ({ one }) => ({
    program: one(program, {
      fields: [recordingImportSource.programId],
      references: [program.id],
    }),
  }),
);

// ─── Observability ─────────────────────────────────────────

export const errorEvent = sqliteTable(
  "errorEvent",
  {
    id: cuid("id"),
    signature: text("signature").notNull(),
    source: text("source", {
      enum: ["request", "queue", "cron", "import", "pipeline"],
    }).notNull(),
    route: text("route").notNull(),
    message: text("message").notNull(),
    level: text("level", { enum: ["error", "warning"] })
      .notNull()
      .default("error"),
    count: integer("count").notNull().default(1),
    firstSeenAt: integer("firstSeenAt", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastSeenAt: integer("lastSeenAt", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastVersion: text("lastVersion").notNull(),
    lastNotifiedAt: integer("lastNotifiedAt", { mode: "timestamp" }),
    notifiedCount: integer("notifiedCount").notNull().default(0),
  },
  (table) => [
    uniqueIndex("errorEvent_signature_unique").on(table.signature),
    index("errorEvent_lastSeenAt_idx").on(table.lastSeenAt),
    check(
      "errorEvent_source_check",
      sql`${table.source} in ('request', 'queue', 'cron', 'import', 'pipeline')`,
    ),
    check(
      "errorEvent_level_check",
      sql`${table.level} in ('error', 'warning')`,
    ),
    check(
      "errorEvent_message_length_check",
      sql`length(${table.message}) <= 500`,
    ),
    check("errorEvent_count_check", sql`${table.count} >= 1`),
    check("errorEvent_notifiedCount_check", sql`${table.notifiedCount} >= 0`),
  ],
);

export const platformAlert = sqliteTable(
  "platformAlert",
  {
    id: cuid("id"),
    kind: text("kind", {
      enum: [
        "error.new",
        "error.spike",
        "recording.failed",
        "import.error",
        "health.degraded",
      ],
    }).notNull(),
    subject: text("subject").notNull(),
    idempotencyKey: text("idempotencyKey").notNull(),
    payload: text("payload").notNull(),
    status: text("status", { enum: ["pending", "sent"] })
      .notNull()
      .default("pending"),
    sentAt: integer("sentAt", { mode: "timestamp" }),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("platformAlert_idempotencyKey_unique").on(table.idempotencyKey),
    index("platformAlert_status_attempts_idx").on(table.status, table.attempts),
    check(
      "platformAlert_kind_check",
      sql`${table.kind} in ('error.new', 'error.spike', 'recording.failed', 'import.error', 'health.degraded')`,
    ),
    check(
      "platformAlert_status_check",
      sql`${table.status} in ('pending', 'sent')`,
    ),
    check(
      "platformAlert_attempts_check",
      sql`${table.attempts} between 0 and 5`,
    ),
  ],
);

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
}, (table) => [index("transcript_segment_recording_time_idx").on(table.recordingId, table.startTime, table.id)]);

export const transcriptSegmentRelations = relations(
  transcriptSegment,
  ({ one }) => ({
    recording: one(recording, {
      fields: [transcriptSegment.recordingId],
      references: [recording.id],
    }),
  }),
);

// ─── ChatSession ───────────────────────────────────────────

export const chatSession = sqliteTable(
  "chat_session",
  {
    id: cuid("id"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ...timestamps,
  },
  (table) => [
    index("chat_session_userId_updatedAt_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);

export const chatSessionRelations = relations(chatSession, ({ one, many }) => ({
  user: one(user, { fields: [chatSession.userId], references: [user.id] }),
  messages: many(chatMessage),
}));

// ─── ChatMessage ───────────────────────────────────────────

export const chatMessage = sqliteTable("chat_message", {
  id: cuid("id"),
  sessionId: text("sessionId").references(() => chatSession.id, {
    onDelete: "cascade",
  }),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  citations: text("citations"),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  // Serves a conversation's transcript, Recent's message counts and the
  // empty-conversation check in saveChatExchange.
  index("chat_message_sessionId_createdAt_idx").on(table.sessionId, table.createdAt),
]);

export const chatMessageRelations = relations(chatMessage, ({ one }) => ({
  session: one(chatSession, {
    fields: [chatMessage.sessionId],
    references: [chatSession.id],
  }),
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
    enum: ["DRAFT", "PUBLISHED", "SUSPENDED"],
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
  contentVersion: integer("contentVersion").notNull().default(0),
  publicName: text("publicName"),
  publicAvatarUrl: text("publicAvatarUrl"),
  moderationOutcome: text("moderationOutcome", {
    enum: ["pass", "hold", "error"],
  }),
  moderationFlags: text("moderationFlags"),
  moderationScores: text("moderationScores"),
  moderationCheckedAt: integer("moderationCheckedAt", { mode: "timestamp" }),
  moderationReviewRequired: integer("moderationReviewRequired", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
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
    posts: many(blogPost),
  }),
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
      table.repoFullName,
    ),
  ],
);

export const profileHighlightRelations = relations(
  profileHighlight,
  ({ one }) => ({
    profile: one(studentProfile, {
      fields: [profileHighlight.profileId],
      references: [studentProfile.id],
    }),
  }),
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

export const profileContactRelations = relations(profileContact, ({ one }) => ({
  profile: one(studentProfile, {
    fields: [profileContact.profileId],
    references: [studentProfile.id],
  }),
}));

// ─── BlogPost ─────────────────────────────────────────────

export const blogPost = sqliteTable(
  "blogPost",
  {
    id: cuid("id"),
    profileId: text("profileId")
      .notNull()
      .references(() => studentProfile.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    contentMarkdown: text("contentMarkdown").notNull(),
    contentHtml: text("contentHtml").notNull().default(""),
    renderedWith: integer("renderedWith").notNull().default(0),
    coverImageKey: text("coverImageKey"),
    coverImageAlt: text("coverImageAlt"),
    readingMinutes: integer("readingMinutes").notNull().default(1),
    status: text("status", {
      enum: ["DRAFT", "PUBLISHED", "SUSPENDED"],
    })
      .notNull()
      .default("DRAFT"),
    adminNote: text("adminNote"),
    publishedAt: integer("publishedAt", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("blogPost_profileId_slug_unique").on(
      table.profileId,
      table.slug,
    ),
    index("blogPost_status_publishedAt_idx").on(
      table.status,
      table.publishedAt,
    ),
    index("blogPost_profileId_status_publishedAt_idx").on(
      table.profileId,
      table.status,
      table.publishedAt,
    ),
    index("blogPost_renderedWith_idx").on(table.renderedWith),
  ],
);

export const blogPostRelations = relations(blogPost, ({ one }) => ({
  profile: one(studentProfile, {
    fields: [blogPost.profileId],
    references: [studentProfile.id],
  }),
}));

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

export const clientProjectRelations = relations(clientProject, ({ many }) => ({
  projectInterests: many(projectInterest),
}));

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
      table.profileId,
    ),
  ],
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
  }),
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
      table.createdAt,
    ),
  ],
);

// ─── Feedback ─────────────────────────────────────────────

export const FEEDBACK_KINDS = [
  "BUG",
  "CONFUSING",
  "IDEA",
  "PRAISE",
  "OTHER",
] as const;
export const FEEDBACK_STATUSES = [
  "NEW",
  "IN_PROGRESS",
  "RESOLVED",
  "DECLINED",
] as const;
export const FEEDBACK_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const FEEDBACK_ATTACHMENT_SOURCES = ["CAPTURE", "UPLOAD"] as const;

export const FEEDBACK_THEME_STATUSES = [
  "COLLECTING",
  "PROPOSED",
  "PLANNED",
  "IN_PROGRESS",
  "SHIPPED",
  "DECLINED",
  "DORMANT",
] as const;
export const FEEDBACK_THEME_CHANGES = ["FIX", "SIMPLIFY", "ADD"] as const;

/**
 * One problem or wish that several notes can share. Title and summary are
 * written to be publishable: they feed public GitHub issues, so they never
 * carry names, quotes or anything else that could identify a student.
 */
export const feedbackTheme = sqliteTable(
  "feedback_theme",
  {
    id: cuid("id"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    kind: text("kind", { enum: FEEDBACK_KINDS }).notNull(),
    status: text("status", { enum: FEEDBACK_THEME_STATUSES })
      .notNull()
      .default("COLLECTING"),
    /** FIX, SIMPLIFY or ADD: decides whether the owner must approve it. */
    change: text("change", { enum: FEEDBACK_THEME_CHANGES }),
    issueUrl: text("issueUrl"),
    prUrl: text("prUrl"),
    /** Private: decision reasons, digest links, task IDs. */
    decisionNote: text("decisionNote"),
    closedAt: integer("closedAt", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    index("feedback_theme_status_updatedAt_idx").on(table.status, table.updatedAt),
    check(
      "feedback_theme_kind_check",
      sql`${table.kind} in ('BUG', 'CONFUSING', 'IDEA', 'PRAISE', 'OTHER')`,
    ),
    check(
      "feedback_theme_status_check",
      sql`${table.status} in ('COLLECTING', 'PROPOSED', 'PLANNED', 'IN_PROGRESS', 'SHIPPED', 'DECLINED', 'DORMANT')`,
    ),
    check(
      "feedback_theme_change_check",
      sql`${table.change} is null or ${table.change} in ('FIX', 'SIMPLIFY', 'ADD')`,
    ),
    check(
      "feedback_theme_title_length_check",
      sql`length(${table.title}) between 1 and 120`,
    ),
    check(
      "feedback_theme_summary_length_check",
      sql`length(${table.summary}) <= 4000`,
    ),
    check(
      "feedback_theme_decisionNote_length_check",
      sql`${table.decisionNote} is null or length(${table.decisionNote}) <= 5000`,
    ),
  ],
);

export const feedbackThemeRelations = relations(feedbackTheme, ({ many }) => ({
  notes: many(feedback),
}));

export const feedback = sqliteTable(
  "feedback",
  {
    id: cuid("id"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: FEEDBACK_KINDS }).notNull(),
    message: text("message").notNull(),
    pageUrl: text("pageUrl").notNull(),
    pageTitle: text("pageTitle"),
    /** JSON written by the widget: viewport, browser, recent client errors. */
    context: text("context").notNull().default("{}"),
    appVersion: text("appVersion"),
    status: text("status", { enum: FEEDBACK_STATUSES })
      .notNull()
      .default("NEW"),
    /** Shown to the student on /dashboard/feedback. */
    response: text("response"),
    /** Staff and agents only. */
    adminNote: text("adminNote"),
    resolutionUrl: text("resolutionUrl"),
    handledById: text("handledById").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: integer("resolvedAt", { mode: "timestamp" }),
    themeId: text("themeId").references(() => feedbackTheme.id, {
      onDelete: "set null",
    }),
    /**
     * Personal or wellbeing content. Never attached to a theme and never
     * summarised anywhere public; the owner handles it directly.
     */
    sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("feedback_status_createdAt_idx").on(table.status, table.createdAt),
    index("feedback_themeId_idx").on(table.themeId),
    index("feedback_userId_createdAt_idx").on(table.userId, table.createdAt),
    check(
      "feedback_kind_check",
      sql`${table.kind} in ('BUG', 'CONFUSING', 'IDEA', 'PRAISE', 'OTHER')`,
    ),
    check(
      "feedback_status_check",
      sql`${table.status} in ('NEW', 'IN_PROGRESS', 'RESOLVED', 'DECLINED')`,
    ),
    check("feedback_message_length_check", sql`length(${table.message}) <= 5000`),
    check("feedback_pageUrl_length_check", sql`length(${table.pageUrl}) <= 2000`),
    check("feedback_context_length_check", sql`length(${table.context}) <= 20000`),
    check(
      "feedback_response_length_check",
      sql`${table.response} is null or length(${table.response}) <= 2000`,
    ),
    check(
      "feedback_adminNote_length_check",
      sql`${table.adminNote} is null or length(${table.adminNote}) <= 5000`,
    ),
  ],
);

export const feedbackRelations = relations(feedback, ({ one, many }) => ({
  user: one(user, { fields: [feedback.userId], references: [user.id] }),
  theme: one(feedbackTheme, {
    fields: [feedback.themeId],
    references: [feedbackTheme.id],
  }),
  attachments: many(feedbackAttachment),
}));

export const feedbackAttachment = sqliteTable(
  "feedback_attachment",
  {
    id: cuid("id"),
    feedbackId: text("feedbackId")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    objectKey: text("objectKey").notNull().unique(),
    contentType: text("contentType", {
      enum: FEEDBACK_ATTACHMENT_TYPES,
    }).notNull(),
    size: integer("size").notNull(),
    source: text("source", { enum: FEEDBACK_ATTACHMENT_SOURCES }).notNull(),
    position: integer("position").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("feedback_attachment_feedbackId_idx").on(table.feedbackId),
    check(
      "feedback_attachment_contentType_check",
      sql`${table.contentType} in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`,
    ),
    check(
      "feedback_attachment_source_check",
      sql`${table.source} in ('CAPTURE', 'UPLOAD')`,
    ),
    check("feedback_attachment_size_check", sql`${table.size} > 0`),
    check(
      "feedback_attachment_position_check",
      sql`${table.position} between 0 and 9`,
    ),
  ],
);

export const feedbackAttachmentRelations = relations(
  feedbackAttachment,
  ({ one }) => ({
    feedback: one(feedback, {
      fields: [feedbackAttachment.feedbackId],
      references: [feedback.id],
    }),
  }),
);

// Community contributions are independent of graduation-gated public talent pages.
export const communityProfile = sqliteTable("communityProfile", {
  userId: text("userId").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  headline: text("headline").notNull().default(""),
  bio: text("bio").notNull().default(""),
  skills: text("skills", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  opportunityGoals: text("opportunityGoals").notNull().default(""),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

export const communityJourney = sqliteTable("communityJourney", {
  id: cuid("id"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  evidenceUrl: text("evidenceUrl"),
  occurredAt: text("occurredAt").notNull(),
  visibility: text("visibility", { enum: ["institution", "private"] }).notNull(),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  index("communityJourney_userId_visibility_idx").on(table.userId, table.visibility),
  check("communityJourney_visibility_check", sql`${table.visibility} IN ('institution', 'private')`),
]);

export const communityConfirmation = sqliteTable("communityConfirmation", {
  id: cuid("id"),
  journeyId: text("journeyId").notNull().references(() => communityJourney.id, { onDelete: "cascade" }),
  mentorId: text("mentorId").notNull().references(() => user.id, { onDelete: "cascade" }),
  statement: text("statement").notNull(),
  method: text("method").notNull(),
  journeyVersion: integer("journeyVersion").notNull(),
  mentorRole: text("mentorRole", {enum:["MENTOR", "ADMIN", "UNKNOWN"]}).notNull().default("UNKNOWN"),
  ...timestamps,
}, (table) => [index("communityConfirmation_journeyId_idx").on(table.journeyId)]);

/**
 * A mentor's private "I can't confirm this" for one revision of a shared
 * contribution: it only leaves that mentor's waiting list, and a new revision
 * waits again. Only the mentor's own Confirm page reads it; it is never a
 * signal about the member (src/lib/mentoring/README.md).
 */
export const communitySetAside = sqliteTable("communitySetAside", {
  mentorId: text("mentorId").notNull().references(() => user.id, { onDelete: "cascade" }),
  journeyId: text("journeyId").notNull().references(() => communityJourney.id, { onDelete: "cascade" }),
  journeyVersion: integer("journeyVersion").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  primaryKey({ columns: [table.mentorId, table.journeyId, table.journeyVersion] }),
  index("communitySetAside_journeyId_idx").on(table.journeyId),
  check("communitySetAside_journeyVersion_check", sql`${table.journeyVersion} >= 1`),
]);

// Registry membership is required for synthetic staging authority; names alone never grant it.
export const stagingFixtureIdentity = sqliteTable("stagingFixtureIdentity", {
  userId: text("userId").primaryKey().references(() => user.id, {onDelete:"cascade"}),
  sessionId: text("sessionId").notNull().unique().references(() => session.id, {onDelete:"cascade"}),
  runId: text("runId").notNull(),
  persona: text("persona", {enum:["member","otherMember","mentor","institution","unapprovedInstitution","admin"]}).notNull(),
  expiresAt: integer("expiresAt").notNull(),
}, table => [index("stagingFixtureIdentity_runId_idx").on(table.runId)]);

// One approved retained-persona QA run; revocation tombstone prevents reissuance.
export const stagingQaRun = sqliteTable("stagingQaRun", {
  id: text("id").primaryKey(),
  issuedAt: integer("issuedAt").notNull(),
  expiresAt: integer("expiresAt").notNull(),
  revokedAt: integer("revokedAt"),
  version: text("version").notNull(),
  keyFingerprint: text("keyFingerprint").notNull(),
  seedDigest: text("seedDigest").notNull(),
});
export const stagingQaSession = sqliteTable("stagingQaSession", {
  tokenHash: text("tokenHash").notNull().unique(),
  sessionId: text("sessionId").primaryKey().references(() => session.id, {onDelete:"cascade"}),
  runId: text("runId").notNull().references(() => stagingQaRun.id),
  userId: text("userId").notNull().references(() => user.id),
  persona: text("persona").notNull(),
}, table => [uniqueIndex("stagingQaSession_run_user_idx").on(table.runId, table.userId)]);
export const stagingQaResource = sqliteTable("stagingQaResource", {
  id: text("id").primaryKey(),
  runId: text("runId").notNull().references(() => stagingQaRun.id),
  kind: text("kind", {enum:["journey","confirmation"]}).notNull(),
  userId: text("userId").notNull().references(() => user.id),
}, table => [index("stagingQaResource_run_idx").on(table.runId)]);

// ─── Channels (src/lib/channels/README.md) ─────────────────
// Timestamps are epoch milliseconds, like attention. Cohort and community
// membership is derived at read time; channel_member holds DIRECT members and
// explicit extras only. Access rules live in capabilitiesFor, never here.

const epochMs = (name: string) => integer(name).notNull().default(sql`(unixepoch() * 1000)`);
const jsonArray = (name: string) => text(name).notNull().default("[]");
const isJsonArray = (column: AnySQLiteColumn) => sql`json_valid(${column}) AND json_type(${column}) = 'array'`;

export const channel = sqliteTable("channel", {
  id: cuid("id"),
  kind: text("kind", { enum: ["COHORT", "COMMUNITY", "DIRECT"] }).notNull(),
  programId: text("programId").references(() => program.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  topic: text("topic").notNull().default(""),
  postingPolicy: text("postingPolicy", { enum: ["ALL", "STAFF"] }).notNull().default("ALL"),
  /** Display order within a space (cohort channels within their cohort); ties sort by name. */
  position: integer("position").notNull().default(0),
  /** Stable identity of a channel the platform created, so seeding never duplicates a renamed channel. */
  seedKey: text("seedKey"),
  archivedAt: integer("archivedAt"),
  createdAt: epochMs("createdAt"),
  updatedAt: epochMs("updatedAt"),
}, (table) => [
  uniqueIndex("channel_slug_idx").on(table.slug).where(sql`${table.kind} <> 'DIRECT'`),
  uniqueIndex("channel_seedKey_idx").on(table.seedKey),
  index("channel_kind_idx").on(table.kind, table.programId),
  index("channel_programId_idx").on(table.programId),
  check("channel_kind_check", sql`${table.kind} IN ('COHORT','COMMUNITY','DIRECT')`),
  check("channel_program_check", sql`(${table.kind} = 'COHORT') = (${table.programId} IS NOT NULL)`),
  check("channel_postingPolicy_check", sql`${table.postingPolicy} IN ('ALL','STAFF')`),
  check("channel_slug_check", sql`length(${table.slug}) BETWEEN 1 AND 80 AND ${table.slug} GLOB '[a-z0-9]*' AND ${table.slug} NOT GLOB '*[^a-z0-9-]*' AND ${table.slug} NOT GLOB '*-'`),
  check("channel_name_check", sql`length(trim(${table.name})) > 0 AND length(${table.name}) <= 80`),
  check("channel_topic_check", sql`length(${table.topic}) <= 280`),
  check("channel_position_check", sql`${table.position} >= 0`),
  check("channel_time_check", sql`${table.createdAt} >= 0 AND ${table.updatedAt} >= ${table.createdAt} AND (${table.archivedAt} IS NULL OR ${table.archivedAt} >= 0)`),
]);

export const channelMember = sqliteTable("channel_member", {
  channelId: text("channelId").notNull().references(() => channel.id, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  addedBy: text("addedBy").references(() => user.id, { onDelete: "set null" }),
  createdAt: epochMs("createdAt"),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.userId] }),
  index("channel_member_userId_idx").on(table.userId, table.channelId),
  index("channel_member_addedBy_idx").on(table.addedBy).where(sql`${table.addedBy} IS NOT NULL`),
  check("channel_member_time_check", sql`${table.createdAt} >= 0`),
]);

/**
 * seq and changeSeq come from one per-channel counter (MAX(changeSeq) + 1,
 * assigned inside the writing statement, so D1's serialised writes keep it
 * strictly increasing): seq is a message's fixed position, changeSeq its
 * latest change. Paging reads seq; `since` polling reads changeSeq, so edits,
 * deletions and moderation reach clients that already hold the message.
 */
export const channelMessage = sqliteTable("channel_message", {
  id: cuid("id"),
  channelId: text("channelId").notNull().references(() => channel.id, { onDelete: "cascade" }),
  // Threads are one level deep; the composite key below keeps a reply in its parent's channel.
  parentId: text("parentId"),
  seq: integer("seq").notNull(),
  changeSeq: integer("changeSeq").notNull(),
  authorKind: text("authorKind", { enum: ["USER", "TEMBO"] }).notNull().default("USER"),
  // Null for Tembo, and for a person whose account was deleted ("Deleted user").
  authorId: text("authorId").references(() => user.id, { onDelete: "set null" }),
  clientNonce: text("clientNonce"),
  body: text("body").notNull(),
  embeds: jsonArray("embeds"),
  citations: jsonArray("citations"),
  moderationState: text("moderationState", { enum: ["VISIBLE", "FLAGGED", "HIDDEN"] }).notNull().default("VISIBLE"),
  moderationReasons: jsonArray("moderationReasons"),
  hiddenBy: text("hiddenBy").references(() => user.id, { onDelete: "set null" }),
  hiddenAt: integer("hiddenAt"),
  editedAt: integer("editedAt"),
  deletedAt: integer("deletedAt"),
  createdAt: epochMs("createdAt"),
}, (table) => [
  foreignKey({ columns: [table.parentId, table.channelId], foreignColumns: [table.id, table.channelId] }).onDelete("cascade"),
  uniqueIndex("channel_message_channel_id_idx").on(table.channelId, table.id),
  uniqueIndex("channel_message_seq_idx").on(table.channelId, table.seq),
  uniqueIndex("channel_message_changeSeq_idx").on(table.channelId, table.changeSeq),
  index("channel_message_thread_idx").on(table.channelId, table.parentId, table.seq),
  uniqueIndex("channel_message_nonce_idx").on(table.authorId, table.clientNonce),
  index("channel_message_hiddenBy_idx").on(table.hiddenBy).where(sql`${table.hiddenBy} IS NOT NULL`),
  check("channel_message_seq_check", sql`${table.seq} >= 1 AND ${table.changeSeq} >= ${table.seq}`),
  check("channel_message_authorKind_check", sql`${table.authorKind} IN ('USER','TEMBO')`),
  // Tembo has no account, and only ever answers inside the thread that asked.
  check("channel_message_tembo_check", sql`${table.authorKind} = 'USER' OR (${table.authorId} IS NULL AND ${table.parentId} IS NOT NULL)`),
  check("channel_message_nonce_check", sql`${table.clientNonce} IS NULL OR (length(${table.clientNonce}) BETWEEN 1 AND 128 AND ${table.clientNonce} NOT GLOB '*[^A-Za-z0-9_-]*')`),
  check("channel_message_body_check", sql`length(${table.body}) <= 10000 AND (${table.deletedAt} IS NOT NULL OR length(trim(${table.body}, ' ' || char(9, 10, 13))) > 0)`),
  check("channel_message_embeds_check", isJsonArray(table.embeds)),
  check("channel_message_citations_check", isJsonArray(table.citations)),
  check("channel_message_moderation_check", sql`${table.moderationState} IN ('VISIBLE','FLAGGED','HIDDEN')`),
  // Flagging or hiding always says why; only hidden messages carry who and when.
  check("channel_message_reasons_check", sql`${isJsonArray(table.moderationReasons)} AND (${table.moderationState} = 'VISIBLE' OR json_array_length(${table.moderationReasons}) > 0)`),
  check("channel_message_hidden_check", sql`(${table.moderationState} = 'HIDDEN') = (${table.hiddenAt} IS NOT NULL) AND (${table.hiddenBy} IS NULL OR ${table.moderationState} = 'HIDDEN')`),
  check("channel_message_time_check", sql`${table.createdAt} >= 0 AND coalesce(${table.editedAt}, 0) >= 0 AND coalesce(${table.deletedAt}, 0) >= 0 AND coalesce(${table.hiddenAt}, 0) >= 0`),
]);

/** One read marker per person and channel; unread counts compare seq with the marked message's. */
export const channelRead = sqliteTable("channel_read", {
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  channelId: text("channelId").notNull().references(() => channel.id, { onDelete: "cascade" }),
  lastReadMessageId: text("lastReadMessageId").notNull(),
  readAt: integer("readAt").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.channelId] }),
  // The marked message must belong to the channel it marks.
  foreignKey({ columns: [table.channelId, table.lastReadMessageId], foreignColumns: [channelMessage.channelId, channelMessage.id] }).onDelete("cascade"),
  index("channel_read_channelId_idx").on(table.channelId, table.lastReadMessageId),
  check("channel_read_time_check", sql`${table.readAt} >= 0`),
]);

/** Desired state, not a toggle: one row per person, message and reaction from the fixed set. */
export const messageReaction = sqliteTable("message_reaction", {
  messageId: text("messageId").notNull().references(() => channelMessage.id, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["useful", "learned", "thanks", "agree", "congrats"] }).notNull(),
  createdAt: epochMs("createdAt"),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.userId, table.kind] }),
  index("message_reaction_userId_idx").on(table.userId),
  check("message_reaction_kind_check", sql`${table.kind} IN ('useful','learned','thanks','agree','congrats')`),
  check("message_reaction_time_check", sql`${table.createdAt} >= 0`),
]);

/** A member's report. One per person and message, so repeated reports never inflate the count. */
export const messageReport = sqliteTable("message_report", {
  id: cuid("id"),
  messageId: text("messageId").notNull().references(() => channelMessage.id, { onDelete: "cascade" }),
  reporterId: text("reporterId").notNull().references(() => user.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  createdAt: epochMs("createdAt"),
}, (table) => [
  uniqueIndex("message_report_message_reporter_idx").on(table.messageId, table.reporterId),
  index("message_report_reporter_idx").on(table.reporterId, table.createdAt),
  check("message_report_reason_check", sql`length(trim(${table.reason})) > 0 AND length(${table.reason}) <= 2000`),
  check("message_report_time_check", sql`${table.createdAt} >= 0`),
]);

/**
 * Append-only audit trail: who flagged, hid, restored or kept what, and why.
 * Automated sources have no actor; a deleted moderator's events keep their source.
 */
export const moderationEvent = sqliteTable("moderation_event", {
  id: cuid("id"),
  messageId: text("messageId").notNull().references(() => channelMessage.id, { onDelete: "cascade" }),
  action: text("action", { enum: ["FLAG", "HIDE", "RESTORE", "KEEP"] }).notNull(),
  source: text("source", { enum: ["DETECTOR", "CLEF", "REPORT", "MENTOR", "ADMIN"] }).notNull(),
  actorId: text("actorId").references(() => user.id, { onDelete: "set null" }),
  fromState: text("fromState", { enum: ["VISIBLE", "FLAGGED", "HIDDEN"] }).notNull(),
  toState: text("toState", { enum: ["VISIBLE", "FLAGGED", "HIDDEN"] }).notNull(),
  reasons: text("reasons").notNull(),
  createdAt: epochMs("createdAt"),
}, (table) => [
  index("moderation_event_message_idx").on(table.messageId, table.createdAt),
  index("moderation_event_actor_idx").on(table.actorId, table.createdAt),
  check("moderation_event_action_check", sql`${table.action} IN ('FLAG','HIDE','RESTORE','KEEP')`),
  check("moderation_event_source_check", sql`${table.source} IN ('DETECTOR','CLEF','REPORT','MENTOR','ADMIN')`),
  check("moderation_event_state_check", sql`${table.fromState} IN ('VISIBLE','FLAGGED','HIDDEN') AND ${table.toState} IN ('VISIBLE','FLAGGED','HIDDEN')`),
  check("moderation_event_actor_check", sql`${table.source} NOT IN ('DETECTOR','CLEF') OR ${table.actorId} IS NULL`),
  check("moderation_event_reasons_check", sql`${isJsonArray(table.reasons)} AND json_array_length(${table.reasons}) > 0`),
  check("moderation_event_time_check", sql`${table.createdAt} >= 0`),
]);
