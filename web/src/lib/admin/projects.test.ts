import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { PROJECT_QUEUE, parseProjectStatus } from "./projects";

describe("the admin's client project list", () => {
  it("works through every stored status, waiting ones first", () => {
    expect(PROJECT_QUEUE.toSorted()).toEqual([...schema.clientProject.status.enumValues].toSorted());
    expect(PROJECT_QUEUE[0]).toBe("PENDING");
  });

  it("reads a status filter only when it is one a project can have", () => {
    for (const status of PROJECT_QUEUE) expect(parseProjectStatus(status)).toBe(status);
    expect(parseProjectStatus(null)).toBeNull();
    expect(parseProjectStatus("pending")).toBeNull();
  });
});
