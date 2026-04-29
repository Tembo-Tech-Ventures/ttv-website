import { describe, it, expect } from "vitest";
import * as schema from "./schema";

describe("Database Schema", () => {
  it("exports all expected tables", () => {
    expect(schema.user).toBeDefined();
    expect(schema.account).toBeDefined();
    expect(schema.session).toBeDefined();
    expect(schema.verification).toBeDefined();
    expect(schema.role).toBeDefined();
    expect(schema.userRole).toBeDefined();
    expect(schema.file).toBeDefined();
    expect(schema.curriculum).toBeDefined();
    expect(schema.program).toBeDefined();
    expect(schema.programRole).toBeDefined();
    expect(schema.programPartner).toBeDefined();
    expect(schema.programApplication).toBeDefined();
  });

  it("exports all expected relations", () => {
    expect(schema.userRelations).toBeDefined();
    expect(schema.accountRelations).toBeDefined();
    expect(schema.sessionRelations).toBeDefined();
    expect(schema.roleRelations).toBeDefined();
    expect(schema.userRoleRelations).toBeDefined();
    expect(schema.fileRelations).toBeDefined();
    expect(schema.curriculumRelations).toBeDefined();
    expect(schema.programRelations).toBeDefined();
    expect(schema.programRoleRelations).toBeDefined();
    expect(schema.programPartnerRelations).toBeDefined();
    expect(schema.programApplicationRelations).toBeDefined();
  });

  it("programApplication has correct status enum values", () => {
    const statusCol = schema.programApplication.status;
    expect(statusCol.enumValues).toEqual([
      "PENDING",
      "APPROVED",
      "REJECTED",
      "AUDIT",
      "COMPLETED",
    ]);
  });

  it("programRole has correct name enum values", () => {
    const nameCol = schema.programRole.name;
    expect(nameCol.enumValues).toEqual(["INSTRUCTOR", "TA"]);
  });

  it("user email has unique constraint", () => {
    const emailCol = schema.user.email;
    expect(emailCol.isUnique).toBe(true);
  });

  it("session token has unique constraint", () => {
    const tokenCol = schema.session.token;
    expect(tokenCol.isUnique).toBe(true);
  });
});
