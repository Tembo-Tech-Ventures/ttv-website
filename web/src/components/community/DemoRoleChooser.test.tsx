import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DemoRoleChooser, { type DemoAccessError } from "./DemoRoleChooser";

const render = (props: Partial<React.ComponentProps<typeof DemoRoleChooser>> = {}) => renderToStaticMarkup(<DemoRoleChooser activePersona={null} canSwitch onSelect={() => {}} {...props} />);

describe("demo role chooser", () => {
  it("offers exactly four fictional perspectives without inventing cohort privileges", () => {
    const html = render();
    expect(html.match(/<button /g)).toHaveLength(4);
    for (const label of ["Cohort member", "Community member", "Mentor", "Institution"]) expect(html).toContain(label);
    expect(html).toContain("contributions are fictional");
    expect(html).toContain("Cohort membership is separate from community access");
    expect(html).not.toContain('disabled=""');
  });
  it("marks only the active role", () => {
    const html = render({ activePersona: "mentor" });
    expect(html.match(/Current role/g)).toHaveLength(1);
  });
  it.each(["expired", "forbidden"] as DemoAccessError[])("blocks every switch for %s access", (error) => {
    const html = render({ error });
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).toContain('role="alert"');
    if (error === "expired") expect(html).toContain('href="/demo"');
  });
  it("disables actions and announces pending work without marking it as active", () => {
    const html = render({ pendingPersona: "institution", activePersona: "mentor" });
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Opening your demo workspace");
    expect(html.match(/Current role/g)).toHaveLength(1);
  });
  it("disables all choices when the server denies switching", () => {
    expect(render({ canSwitch: false }).match(/disabled=""/g)).toHaveLength(4);
  });
  it.each(["unavailable", "failed"] as DemoAccessError[])("leaves manual retry available after %s without submitting automatically", (error) => {
    const onSelect = vi.fn();
    const html = render({ error, onSelect });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('disabled=""');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
