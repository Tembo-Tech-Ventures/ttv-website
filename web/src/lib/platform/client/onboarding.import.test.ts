// @vitest-environment node
import { expect, it, vi } from "vitest";

// Production entry points must load without synthetic data or the mock transport, and without browser globals.
vi.mock("../fixtures", () => { throw new Error("Synthetic fixtures imported by the production onboarding entry"); });
vi.mock("./mockTransport", () => { throw new Error("Mock transport imported by the production onboarding entry"); });

it("loads the onboarding store and hook on the server with no side effects", async () => {
  expect(typeof window).toBe("undefined");
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const { createOnboardingStore, useOnboarding } = await import("./onboarding");
  const { clearOnboardingDrafts, sessionDraftStorage } = await import("./onboarding-drafts");
  const store = createOnboardingStore({ enabled: true, draftKey: "ttv-onboarding-drafts:synthetic-user" });
  expect(store.getState()).toMatchObject({ server: null });
  expect(store.getState().drafts).toEqual({});
  expect(typeof useOnboarding).toBe("function");
  expect(sessionDraftStorage()).toBeUndefined();
  expect(() => clearOnboardingDrafts()).not.toThrow();
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
