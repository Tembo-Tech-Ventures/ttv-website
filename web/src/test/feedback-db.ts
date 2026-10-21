import { vi } from "vitest";
import { MINIMAL_AUTH_SCHEMA, createSqliteD1, readMigration } from "./sqlite-d1";

export const STUDENT = { id: "student-1", name: "Amina Njoroge", email: "amina@example.com" };
export const OTHER_STUDENT = { id: "student-2", name: "Kwame Mensah", email: "kwame@example.com" };
export const ADMIN = { id: "admin-1", name: "Rafa Admin", email: "admin@example.com" };

/** In-memory D1 with users, an ADMIN role, and the feedback migration applied. */
export function createFeedbackTestDb() {
  const { database, db } = createSqliteD1();
  database.exec(MINIMAL_AUTH_SCHEMA);
  database.exec(readMigration("0015_student_feedback.sql"));
  database.exec(readMigration("0016_feedback_themes.sql"));
  const insertUser = database.prepare(
    `INSERT INTO "user" ("id", "name", "email") VALUES (?, ?, ?)`
  );
  for (const user of [STUDENT, OTHER_STUDENT, ADMIN]) {
    insertUser.run(user.id, user.name, user.email);
  }
  database.exec(`
    INSERT INTO "Roles" ("id", "name") VALUES ('role-admin', 'ADMIN');
    INSERT INTO "UserRoles" ("id", "userId", "roleId") VALUES ('ur-1', '${ADMIN.id}', 'role-admin');
  `);
  return { database, db };
}

/** An R2 stand-in that keeps objects in memory. */
export function createMemoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    objects,
    put: vi.fn(async (key: string, value: Uint8Array, options?: R2PutOptions) => {
      const metadata = options?.httpMetadata as R2HTTPMetadata | undefined;
      objects.set(key, { bytes: value, contentType: metadata?.contentType });
      return { key } as R2Object;
    }),
    get: vi.fn(async (key: string) => {
      const object = objects.get(key);
      if (!object) return null;
      return {
        body: new Blob([object.bytes as BlobPart]).stream(),
        size: object.bytes.byteLength,
      };
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    }),
  };
}

export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

export function imageFile(bytes: Uint8Array, name = "shot.png", type = "image/png") {
  return new File([bytes as BlobPart], name, { type });
}
