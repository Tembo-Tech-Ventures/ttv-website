import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN, OTHER_STUDENT, STUDENT, createFeedbackTestDb } from "@/test/feedback-db";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));

import { GET as listThemesRoute, POST as createThemeRoute } from "@/pages/api/admin/feedback/themes/index";
import { GET as getThemeRoute, PATCH as patchThemeRoute } from "@/pages/api/admin/feedback/themes/[id]";
import { GET as listNotesRoute } from "@/pages/api/admin/feedback/index";
import { PATCH as patchNoteRoute } from "@/pages/api/admin/feedback/[id]";

const ORIGIN = "https://tembotechventures.com";
let setup: ReturnType<typeof createFeedbackTestDb>;

beforeEach(() => {
  setup = createFeedbackTestDb();
  Object.assign(mocks.env, { DB: setup.db });
  const insert = setup.database.prepare(
    `INSERT INTO "feedback" ("id", "userId", "kind", "message", "pageUrl")
     VALUES (?, ?, 'IDEA', ?, 'https://tembotechventures.com/dashboard/sessions')`
  );
  insert.run("n1", STUDENT.id, "Mark sessions I've watched");
  insert.run("n2", OTHER_STUDENT.id, "Which recordings did I already see?");
});

function context({
  path,
  method = "GET",
  body,
  id,
  isAdmin = true,
}: {
  path: string;
  method?: string;
  body?: unknown;
  id?: string;
  isAdmin?: boolean;
}) {
  const url = new URL(path, ORIGIN);
  return {
    url,
    params: { id },
    request: new Request(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    locals: { isAdmin, user: isAdmin ? ADMIN : STUDENT },
  } as never;
}

interface Body {
  id: string;
  error?: string;
  theme?: unknown;
  items: Array<{ id: string }>;
  [key: string]: unknown;
}

async function json(response: Response) {
  return { status: response.status, body: (await response.json()) as Body };
}

describe("theme routes", () => {
  it("are admin-only", async () => {
    expect((await listThemesRoute(context({ path: "/api/admin/feedback/themes", isAdmin: false }))).status).toBe(403);
    expect(
      (await createThemeRoute(context({ path: "/x", method: "POST", body: {}, isAdmin: false }))).status
    ).toBe(403);
  });

  it("carry a theme from collecting to shipped, answering every student", async () => {
    const created = await json(
      await createThemeRoute(
        context({
          path: "/api/admin/feedback/themes",
          method: "POST",
          body: { title: "Show which sessions I have watched", kind: "IDEA", change: "ADD" },
        })
      )
    );
    expect(created.status).toBe(201);
    const themeId = created.body.id;
    expect(created.body).toMatchObject({
      status: "COLLECTING",
      stats: { notes: 0, students: 0 },
      assessment: { readyToPropose: false, approval: "owner" },
      adminUrl: `${ORIGIN}/admin/feedback/themes/${themeId}`,
    });

    for (const noteId of ["n1", "n2"]) {
      const attached = await json(
        await patchNoteRoute(
          context({ path: `/api/admin/feedback/${noteId}`, method: "PATCH", id: noteId, body: { themeId } })
        )
      );
      expect(attached.body.theme).toMatchObject({ id: themeId, status: "COLLECTING" });
    }

    const detail = await json(await getThemeRoute(context({ path: "/x", id: themeId })));
    expect(detail.body).toMatchObject({
      stats: { notes: 2, students: 2, recentStudents: 2 },
      assessment: { readyToPropose: false, reason: "Needs 1 more student within 60 days." },
      noteIds: ["n1", "n2"],
    });

    const listed = await json(await listNotesRoute(context({ path: `/api/admin/feedback?themeId=${themeId}` })));
    expect(listed.body.items).toHaveLength(2);

    const refused = await json(
      await patchThemeRoute(context({ path: "/x", method: "PATCH", id: themeId, body: { status: "SHIPPED" } }))
    );
    expect(refused.status).toBe(400);

    const shipped = await json(
      await patchThemeRoute(
        context({
          path: "/x",
          method: "PATCH",
          id: themeId,
          body: {
            status: "SHIPPED",
            prUrl: "https://github.com/Tembo-Tech-Ventures/ttv-website/pull/300",
            studentMessage: "Watched sessions now show a tick.",
          },
        })
      )
    );
    expect(shipped.body).toMatchObject({ status: "SHIPPED" });
    const note = await json(await listNotesRoute(context({ path: "/api/admin/feedback?status=RESOLVED" })));
    expect(note.body.items.map((item) => item.id).toSorted()).toEqual(["n1", "n2"]);
  });

  it("filters, and reports bad input and unknown themes", async () => {
    expect((await listThemesRoute(context({ path: "/api/admin/feedback/themes?status=done" }))).status).toBe(400);
    expect(
      (await createThemeRoute(context({ path: "/x", method: "POST", body: { kind: "IDEA" } }))).status
    ).toBe(400);
    expect((await getThemeRoute(context({ path: "/x", id: "missing" }))).status).toBe(404);
    expect(
      (await patchThemeRoute(context({ path: "/x", method: "PATCH", id: "missing", body: { status: "PLANNED" } })))
        .status
    ).toBe(404);
    const badAttach = await json(
      await patchNoteRoute(context({ path: "/x", method: "PATCH", id: "n1", body: { themeId: "missing" } }))
    );
    expect(badAttach).toEqual({ status: 400, body: { error: "That theme does not exist." } });
  });

  it("lists only unsorted notes for triage", async () => {
    await patchNoteRoute(context({ path: "/x", method: "PATCH", id: "n2", body: { sensitive: true } }));
    const untriaged = await json(await listNotesRoute(context({ path: "/api/admin/feedback?untriaged=1" })));
    expect(untriaged.body.items.map((item) => item.id)).toEqual(["n1"]);
  });
});
