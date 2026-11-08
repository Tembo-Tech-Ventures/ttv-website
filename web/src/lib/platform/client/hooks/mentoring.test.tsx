// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mentors, people, pendingMentorRequest } from "../../fixtures";
import { createRequestFormStore, mentorRequestDraftKey, type RequestFormStore } from "../mentor-request-form";
import { createMentorRequestsStore, shownStatus, type MentorRequestsStore } from "../mentor-requests";
import { createMentoringMock } from "../mentoring.mock";
import { useMentorRequests, useRequestForm } from "./mentoring";

const david = mentors.items[0];

function Note({ store }: { store: RequestFormStore }) {
  return <span>{useRequestForm(store, state => state.note) || "empty"}</span>;
}
function Status({ store }: { store: MentorRequestsStore }) {
  const shown = useMentorRequests(store, state => shownStatus(state, pendingMentorRequest));
  return <span>{shown}</span>;
}

describe("mentor connection hooks", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders the empty form on the server and restores the tab's draft once mounted", async () => {
    sessionStorage.setItem(mentorRequestDraftKey(people.wanjiku.id, david.person.id), JSON.stringify({ note: "Kept for the tab", project: null, format: null }));
    const form = createRequestFormStore({ userId: people.wanjiku.id, mentor: david, projects: [], mock: createMentoringMock().api });
    expect(renderToString(<Note store={form} />)).toContain("empty");
    await act(async () => root.render(<StrictMode><Note store={form} /></StrictMode>));
    expect(container.textContent).toBe("Kept for the tab");
  });

  it("follows optimistic changes, and keeps working after a strict-mode remount", async () => {
    const mock = createMentoringMock({ viewer: people.david, latencyMs: 20 });
    const store = createMentorRequestsStore({ as: "mentor", initial: { items: mock.requests(), nextCursor: null }, mock: mock.api });
    await act(async () => root.render(<StrictMode><Status store={store} /></StrictMode>));
    expect(container.textContent).toBe("PENDING");
    let accepting!: Promise<unknown>;
    act(() => { accepting = store.accept(pendingMentorRequest.id); });
    expect(container.textContent).toBe("ACCEPTED");
    await act(async () => { await accepting; });
    expect(store.getState().items.find(item => item.id === pendingMentorRequest.id)?.channelId).not.toBeNull();
  });
});
