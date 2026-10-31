// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openFeedbackWidget, takeFeedbackRequest } from "./feedback-client";
import FeedbackWidget from "./FeedbackWidget";

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
  takeFeedbackRequest();
  vi.unstubAllGlobals();
});

it("opens once on mount when a menu asked for it before the widget hydrated", async () => {
  openFeedbackWidget();
  await act(async () => root.render(<FeedbackWidget showLauncher={false} />));
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(takeFeedbackRequest()).toBe(false);
});

it("keeps repeated early requests to one open form and one pending intent", async () => {
  openFeedbackWidget();
  openFeedbackWidget();
  openFeedbackWidget();
  await act(async () => root.render(<FeedbackWidget showLauncher={false} />));
  await act(async () => openFeedbackWidget());
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  // Nothing is left over to reopen the form once it is closed.
  expect(takeFeedbackRequest()).toBe(false);
});

it("stays closed on mount when nobody asked", async () => {
  await act(async () => root.render(<FeedbackWidget showLauncher={false} />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("answers a request made after it hydrated, and does not reopen from it later", async () => {
  await act(async () => root.render(<FeedbackWidget showLauncher={false} />));
  await act(async () => openFeedbackWidget());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(takeFeedbackRequest()).toBe(false);
});
