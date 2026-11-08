import { asc, count, desc, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/paging";

/*
 * The admin's list of client projects: filtered and ordered in SQL, a page at
 * a time, with how many builders said they're interested counted in SQL too.
 */

export const PROJECTS_PATH = "/admin/projects";
export type ProjectStatus = (typeof schema.clientProject.status.enumValues)[number];

/** The statuses in the order a reviewer works through them: waiting first, closed last. */
export const PROJECT_QUEUE: readonly ProjectStatus[] = ["PENDING", "APPROVED", "MATCHED", "REJECTED", "CLOSED"];

/** The status asked for in `?status=`, if it is one a project can have. */
export function parseProjectStatus(value: string | null): ProjectStatus | null {
  return PROJECT_QUEUE.find((status) => status === value) ?? null;
}

const QUEUE_ORDER = sql`case ${schema.clientProject.status} when 'PENDING' then 0 when 'APPROVED' then 1 when 'MATCHED' then 2 when 'REJECTED' then 3 else 4 end`;

/** One page of projects with their interest counts, and how many there are in each status: read together. */
export async function readProjectsPage(db: Database, { status, page }: { status: ProjectStatus | null; page: number }) {
  const project = schema.clientProject;
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: project.id,
        organization: project.organization,
        title: project.title,
        budgetBand: project.budgetBand,
        timeline: project.timeline,
        status: project.status,
        createdAt: project.createdAt,
        interest: count(schema.projectInterest.id),
      })
      .from(project)
      .leftJoin(schema.projectInterest, eq(schema.projectInterest.projectId, project.id))
      .where(status ? eq(project.status, status) : undefined)
      .groupBy(project.id)
      .orderBy(QUEUE_ORDER, desc(project.createdAt), asc(project.id))
      .limit(ADMIN_PAGE_SIZE)
      .offset((page - 1) * ADMIN_PAGE_SIZE),
    db.select({ status: project.status, total: count() }).from(project).groupBy(project.status),
  ]);
  const byStatus = new Map<string, number>(counts.map((row) => [row.status, row.total]));
  const total = status ? (byStatus.get(status) ?? 0) : counts.reduce((sum, row) => sum + row.total, 0);
  return { rows, total, byStatus };
}
