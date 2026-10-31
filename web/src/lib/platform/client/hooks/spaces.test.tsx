// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { meByPersona } from "../../fixtures";
import { createSpacesController, type SpacesController } from "../spaces";
import { createMockSpacesController } from "../spaces.mock";
import { useSpaces } from "./spaces";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

function View({ controller }: { controller: SpacesController }) {
  const state = useSpaces(controller);
  return <span>{state.selectedSpace}:{state.drawer.open ? "open" : "closed"}</span>;
}

it("hydrates a server default without mismatch, then applies the cookie and observes switches", async () => {
  document.cookie = "ttv-last-space=profile; Path=/";
  const controller = createSpacesController({ me: meByPersona.wanjiku });
  const html = renderToString(<View controller={controller} />);
  expect(html).toContain("cohort");
  await act(async () => root.unmount());
  container.innerHTML = html;
  const onRecoverableError = vi.fn();
  await act(async () => { root = hydrateRoot(container, <View controller={controller} />, { onRecoverableError }); });
  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(container.textContent).toBe("profile:closed");
  await act(async () => { controller.switchSpace("community"); controller.dispatchDrawer({ type: "open", itemCount: 3 }); });
  expect(container.textContent).toBe("community:open");
  await act(async () => { controller.handleDrawerKey("Escape", 3); });
  expect(container.textContent).toBe("community:closed");
  await act(async () => { controller.setContext(null); });
  expect(container.textContent).toBe(":closed");
});

it("offers fixture mock mode, replaces controllers and unsubscribes on unmount", async () => {
  const first = createMockSpacesController("wanjiku");
  const second = createMockSpacesController("lucy");
  const stop = vi.fn(); const subscribe = first.subscribe;
  vi.spyOn(first, "subscribe").mockImplementation(listener => {
    const unsubscribe = subscribe(listener); return () => { stop(); unsubscribe(); };
  });
  await act(async () => root.render(<View controller={first} />));
  expect(container.textContent).toBe("cohort:closed");
  await act(async () => root.render(<View controller={second} />));
  expect(stop).toHaveBeenCalledTimes(1);
  await act(async () => { first.switchSpace("profile"); });
  expect(container.textContent).toBe("community:closed");
  await act(async () => { second.switchSpace("profile"); });
  expect(container.textContent).toBe("profile:closed");
});

it("supports a stable per-island controller in the hook's usage pattern", async () => {
  function MockView() {
    const [controller] = useState(() => createMockSpacesController("david"));
    const { selectedSpace, switchSpace } = useSpaces(controller);
    return <button onClick={() => switchSpace("mentoring")}>{selectedSpace}</button>;
  }
  await act(async () => root.render(<MockView />));
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toBe("mentoring");
});
