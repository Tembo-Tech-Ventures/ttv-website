import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

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

// ─── User ──────────────────────────────────────────────────

export const user = sqliteTable("user", {
  id: cuid("id"),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp" }),
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
}));

// ─── Account ───────────────────────────────────────────────

export const account = sqliteTable(
  "account",
  {
    id: cuid("id"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => ({
    providerProviderAccountIdIdx: uniqueIndex("account_provider_providerAccountId_unique").on(
      table.provider,
      table.providerAccountId
    ),
  })
);

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

// ─── Session ───────────────────────────────────────────────

export const session = sqliteTable("session", {
  id: cuid("id"),
  sessionToken: text("sessionToken").notNull().unique(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp" }).notNull(),
});

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

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
