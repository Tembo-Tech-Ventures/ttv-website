import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ScoutWorkspace, { EvidenceLinks } from "./ScoutWorkspace";
import { demoProfiles } from "./fixtures";
import { evidenceHref, filterDemoProfiles } from "./types";

describe("institution scouting", () => {
  it("explains the demo limits and labels every criterion", () => {
    const html = renderToStaticMarkup(
      <ScoutWorkspace profiles={demoProfiles} demo />,
    );
    expect(html).toContain("Fictional profiles and sample responses");
    expect(html).toContain("What are you working on?");
    expect(html).toContain("Skills to explore");
    expect(html).toContain("Already have someone in mind?");
    expect(html).toContain("does not rank these sample profiles");
    expect(html).not.toContain("verified person");
  });
  it("does not render demo personas or navigation in the production initial state", () => {
    const html = renderToStaticMarkup(<ScoutWorkspace profiles={[]} />);
    expect(html).not.toContain("/dev/community-ui");
    expect(html).not.toContain("Fictional profiles");
    expect(html).toContain('aria-current="step"');
  });
  it("requires all requested skill matches and distinguishes no matches", () => {
    expect(
      filterDemoProfiles(demoProfiles, {
        context: "",
        skills: "React, ACCESSIBILITY",
        query: "",
      }).map((profile) => profile.name),
    ).toEqual(["Amara Okafor"]);
    expect(
      filterDemoProfiles(demoProfiles, {
        context: "",
        skills: "Rust",
        query: "",
      }),
    ).toEqual([]);
  });
  it("supports a known person search without inventing context-based ranking", () => {
    expect(
      filterDemoProfiles(demoProfiles, {
        context: "needs a data engineer",
        skills: "",
        query: " nia ",
      }).map((profile) => profile.name),
    ).toEqual(["Nia Diallo"]);
    expect(
      filterDemoProfiles(demoProfiles, {
        context: "a fictional scoring instruction",
        skills: "",
        query: "",
      }),
    ).toEqual(demoProfiles);
  });
  it.each([
    // oxlint-disable-next-line no-script-url -- Negative test for rejected executable URLs.
    "javascript:alert(1)",
    "data:text/html,test",
    "//example.com",
    "not a URL",
  ])("blocks unsafe evidence URL %s", (value) => {
    expect(evidenceHref(value)).toBeNull();
    const html = renderToStaticMarkup(
      <EvidenceLinks
        sources={[
          { id: "source", title: "Evidence", url: value, kind: "Code" },
        ]}
      />,
    );
    expect(html).not.toContain("href=");
    expect(html).toContain("Source link unavailable");
  });
  it("renders safe external evidence with provenance and opener isolation", () => {
    const html = renderToStaticMarkup(
      <EvidenceLinks
        sources={[
          {
            id: "source",
            title: "Project walkthrough",
            url: "https://example.com/project",
            kind: "Member demo",
          },
        ]}
      />,
    );
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Member demo");
  });
});
