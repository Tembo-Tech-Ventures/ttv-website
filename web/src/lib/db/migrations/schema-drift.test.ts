import {
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("the checked-in snapshot generates no migration, especially no referenced-table rebuild", () => {
  const dir = mkdtempSync(join(tmpdir(), "ttv-schema-drift-"));
  try {
    const out = join(dir, "migrations");
    cpSync(resolve("src/lib/db/migrations/meta"), join(out, "meta"), {
      recursive: true,
    });
    const config = join(dir, "drizzle.config.json");
    writeFileSync(
      config,
      JSON.stringify({
        dialect: "sqlite",
        schema: resolve("src/lib/db/schema.ts"),
        out: relative(process.cwd(), out),
      }),
    );
    const output = execFileSync(
      process.execPath,
      [
        resolve("node_modules/drizzle-kit/bin.cjs"),
        "generate",
        "--config",
        config,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(output).toContain("No schema changes");
    expect(readdirSync(out)).toEqual(["meta"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 35_000);
