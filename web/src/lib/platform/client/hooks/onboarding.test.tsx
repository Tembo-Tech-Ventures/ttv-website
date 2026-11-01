// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onboardingByPersona } from "../../fixtures";
import { createApiClient } from "../apiClient";
import { createOnboardingStore, selectAccessStatus, type OnboardingStore } from "../onboarding";
import { createOnboardingMock } from "../onboarding.mock";
import { useOnboarding } from "./onboarding";

function Status({ store }: { store: OnboardingStore }) {
  const status = useOnboarding(store, selectAccessStatus("MENTOR"));
  const intents = useOnboarding(store, state => state.selection.intents.join("+"));
  return <span>{`${status}:${intents}`}</span>;
}

describe("useOnboarding", () => {
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
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("renders server-provided state during SSR without fetching", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const store = createOnboardingStore({ enabled: true, api: createApiClient({ fetch }), initialState: onboardingByPersona.mercyAkinyi });
    expect(renderToString(<Status store={store} />)).toBe("<span>PENDING:MEMBER+MENTOR</span>");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the whole state without a selector", () => {
    const store = createOnboardingStore({ initialState: onboardingByPersona.peter });
    function Whole() {
      const state = useOnboarding(store);
      return <span>{`${state.enabled}:${state.server?.requests[0].status}`}</span>;
    }
    expect(renderToString(<Whole />)).toBe("<span>false:DECLINED</span>");
  });

  it("drives the mock flow and shows Pending only after the server answers", async () => {
    const mock = createOnboardingMock("wairimu", { latencyMs: 0 });
    const store = createOnboardingStore({ enabled: true, mock: mock.api, draftKey: "ttv-onboarding-drafts:wairimu" });
    await act(async () => root.render(<StrictMode><Status store={store} /></StrictMode>));
    expect(container.textContent).toBe("NOT_REQUESTED:");
    await act(async () => {
      store.select({ type: "toggle", intent: "MENTOR" });
      store.updateDraft("MENTOR", { note: "I review mobile apps that members share." });
    });
    expect(container.textContent).toBe("NOT_REQUESTED:MENTOR");
    let sent: Promise<boolean> | undefined;
    await act(async () => { sent = store.submitRequest("MENTOR"); });
    await act(async () => { await sent; });
    expect(container.textContent).toBe("PENDING:MENTOR");
  });

  it("aborts its work when the last component unmounts", async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    });
    const store = createOnboardingStore({ enabled: true, api: createApiClient({ fetch }) });
    await act(async () => root.render(<><Status store={store} /><Status store={store} /></>));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<Status store={store} />));
    expect(signal?.aborted).toBe(false);
    await act(async () => root.render(null));
    expect(signal?.aborted).toBe(true);
    expect(store.getState().loading).toBe(false);
  });
});
