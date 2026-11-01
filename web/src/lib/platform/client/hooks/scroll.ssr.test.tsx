// @vitest-environment node
import { useRef } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { useScrollAnchoring } from "./scroll";

it("server-renders without browser globals or layout-effect warnings", () => {
  expect(typeof document).toBe("undefined");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  function List() {
    const ref = useRef<HTMLElement>(null);
    const { atBottom } = useScrollAnchoring(ref, { items: [{ id: "m1" }] });
    return <section ref={ref} data-at-bottom={atBottom} />;
  }
  expect(renderToString(<List />)).toBe('<section data-at-bottom="true"></section>');
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});
