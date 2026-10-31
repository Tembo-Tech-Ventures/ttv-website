import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStore, useStore } from "./store";

describe("store", () => {
  it("updates functionally, notifies once per change and unsubscribes", () => {
    const store = createStore({ count: 0 }); const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setState(previous => ({ count: previous.count + 1 }));
    expect(store.getState()).toEqual({ count: 1 }); expect(listener).toHaveBeenCalledTimes(1);
    store.setState(previous => previous); expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe(); unsubscribe(); store.setState({ count: 2 }); expect(listener).toHaveBeenCalledTimes(1);
  });

  it("uses a listener snapshot when subscriptions change during notification", () => {
    const store = createStore(0); const second = vi.fn();
    let stop = () => {};
    store.subscribe(() => stop()); stop = store.subscribe(second);
    store.setState(1); store.setState(2); expect(second).toHaveBeenCalledTimes(1);
  });

  it("SSR reads the initial server snapshot, including after client updates", () => {
    const store = createStore({ count: 2 }); store.setState({ count: 5 });
    function View() { return createElement("span", null, useStore(store, s => s.count)); }
    expect(renderToString(createElement(View))).toBe("<span>2</span>");
    expect(store.getServerSnapshot()).toEqual({ count: 2 });
  });
});
