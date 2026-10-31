import { and, desc, eq } from "drizzle-orm";
import type { Me, SpaceId } from "@/lib/platform/contracts";
import { getSpaceContext } from "@/lib/platform/server/space-context";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { DEMO_PREFIX, demoPathAllowed, isDemoUser } from "@/lib/staging-demo-policy";
import { qaPathAllowed } from "@/lib/staging-qa-policy";
import { stagingFixturePathAllowed } from "@/lib/staging-fixture-policy";
import { isValidCompletion } from "@/lib/talent/eligibility";
import { canRenderSpace } from "@/components/platform/shell/access";
import { PAGE_SPACES, type SpacePageKey } from "./sidebar";

/**
 * How an existing dashboard page decides whether it renders inside the spaces
 * shell. The page files stay where they are: B-1.2 serves them at their
 * canonical space paths, and this only changes the frame around them.
 */

export interface SpacePageContext {
  me: Me;
  space: SpaceId;
  page: SpacePageKey;
}

/** The first of the page's spaces this person can open, or null for the existing dashboard. */
export function pickSpace(me: Me | null, page: SpacePageKey): SpaceId | null {
  return PAGE_SPACES[page].find((space) => canRenderSpace(me, space)) ?? null;
}

/**
 * The spaces context for this request, or null when the page keeps its
 * existing dashboard frame: the `spaces` flag is off for the person, the caller
 * is a personal access token (`Me` is browser-session only), or the context
 * could not be loaded. That last case is deliberate. B-1.2 lets a legacy URL
 * fall through to its unchanged handler when the context fails, after every
 * authentication boundary has run; the page then still enforces its own data
 * access and nothing here grants any. Canonical routes never get this far
 * without a context: the middleware fails them closed.
 */
export async function resolveSpacePage(locals: App.Locals, page: SpacePageKey): Promise<SpacePageContext | null> {
  let me: Me;
  try {
    me = await getSpaceContext({ locals });
  } catch {
    return null;
  }
  const space = pickSpace(me, page);
  return space ? { me, space, page } : null;
}

export interface Restrictions {
  qaPersona?: Parameters<typeof qaPathAllowed>[0] | null;
  demo?: boolean;
  fixture?: boolean;
}

export function restrictionsFor(locals: App.Locals): Restrictions {
  return {
    qaPersona: locals.stagingQa?.persona ?? null,
    demo: Boolean(locals.stagingDemo),
    fixture: Boolean(locals.stagingFixture),
  };
}

/**
 * Restricted synthetic identities only see links their allowlists open, as
 * the existing dashboard does, so the sidebar never offers a dead end.
 */
export function linkAllowed({ qaPersona, demo, fixture }: Restrictions, href: string): boolean {
  const path = href.split(/[?#]/, 1)[0]!;
  return (!qaPersona || qaPathAllowed(qaPersona, path, "GET"))
    && (!demo || demoPathAllowed(path, "GET"))
    && (!fixture || stagingFixturePathAllowed(path, "GET"));
}

/** The person's own completed cohorts that have a certificate, newest first. */
export async function loadCertificates(db: Database, userId: string): Promise<{ id: string; programName: string }[]> {
  const applications = await db.query.programApplication.findMany({
    where: and(
      eq(schema.programApplication.userId, userId),
      eq(schema.programApplication.status, "COMPLETED"),
      isDemoUser(userId) ? eq(schema.programApplication.programId, DEMO_PREFIX + "program") : undefined,
    ),
    columns: { id: true, status: true, completedAt: true },
    with: { program: { columns: { name: true } } },
    orderBy: [desc(schema.programApplication.completedAt)],
  });
  return applications
    .filter((application) => isValidCompletion(application) && application.program)
    .map((application) => ({ id: application.id, programName: application.program!.name }));
}
