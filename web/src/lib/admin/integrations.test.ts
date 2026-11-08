import { readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { CREDENTIAL_ACTION_LABEL, RECENT_ACTIVITY, readIntegrationsPage } from "./integrations";

const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

/** Every migration and two admins; `credential` stores the Drive credential, last changed by Amina. */
function seeded({ credential = true, activity = 3 }: { credential?: boolean; activity?: number } = {}) {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO user(id,name,email) VALUES ('synthetic-amina','Amina Hassan','amina@example.test'),('synthetic-otieno','Brian Otieno','otieno@example.test');`);
  if (credential) {
    database.exec(`INSERT INTO integrationCredential(id,provider,ciphertext,displayMetadata,config,updatedByUserId,updatedAt) VALUES
      ('credential','google-drive','sealed','{"clientEmail":"importer@ttv.iam.gserviceaccount.com","projectId":"ttv-recordings","privateKeyIdFingerprint":"0a1b2c3d"}','{"impersonatedUser":"sessions@ttv.example"}','synthetic-amina',1790000000);`);
  }
  const insert = database.prepare(`INSERT INTO credentialAuditLog(id,provider,action,outcome,actorUserId,createdAt) VALUES (?,?,?,?,?,?)`);
  const actors = ["synthetic-amina", "synthetic-otieno", null];
  for (let index = 0; index < activity; index += 1) {
    insert.run(`audit-${String(index).padStart(2, "0")}`, "google-drive", index === 0 ? "set" : "test", index === 0 ? "Credential saved." : "Pass: API: ok", actors[index % 3], 1790000000 + index * 60);
  }
  insert.run("audit-other", "another-provider", "set", "Credential saved.", "synthetic-amina", 1790009999);
  return db;
}

describe("the integrations page's read, on the real schema", () => {
  it("reads the credential's facts, its settings and who changed it last, by name", async () => {
    const raw = seeded();
    const { credential } = await readIntegrationsPage(drizzle(raw, { schema }));
    expect(credential).toEqual({
      facts: { clientEmail: "importer@ttv.iam.gserviceaccount.com", projectId: "ttv-recordings", privateKeyIdFingerprint: "0a1b2c3d" },
      impersonatedUser: "sessions@ttv.example",
      updatedAt: new Date(1790000000 * 1000),
      updatedByName: "Amina Hassan",
    });
  });

  it("lists this provider's activity newest first, each with the person's name joined in SQL", async () => {
    const raw = seeded();
    const { activity } = await readIntegrationsPage(drizzle(raw, { schema }));
    expect(activity.map((entry) => [entry.id, entry.action, entry.by])).toEqual([
      ["audit-02", "test", "Not recorded"],
      ["audit-01", "test", "Brian Otieno"],
      ["audit-00", "set", "Amina Hassan"],
    ]);
    expect(CREDENTIAL_ACTION_LABEL[activity[2].action]).toBe("Saved");
  });

  it("keeps the activity to the most recent entries, and says nothing is stored when nothing is", async () => {
    const raw = seeded({ credential: false, activity: RECENT_ACTIVITY + 3 });
    const { credential, activity } = await readIntegrationsPage(drizzle(raw, { schema }));
    expect(credential).toBeNull();
    expect(activity).toHaveLength(RECENT_ACTIVITY);
  });

  it("reads stored JSON leniently: a broken value reads as no facts, never an error page", async () => {
    const raw = seeded();
    await raw.prepare(`UPDATE integrationCredential SET displayMetadata='not json', config='[1]'`).run();
    const { credential } = await readIntegrationsPage(drizzle(raw, { schema }));
    expect(credential?.facts).toEqual({ clientEmail: undefined, projectId: undefined, privateKeyIdFingerprint: undefined });
    expect(credential?.impersonatedUser).toBeUndefined();
  });
});
