import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ScoutWorkspace, { entryCountLabel, EvidenceLinks, EvidenceOrdering } from "./ScoutWorkspace";
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
    expect(html).toContain("Find community builders through their work.");
    expect(html).toContain("Already have someone in mind?");
    expect(html).toContain("does not rank these sample profiles");
    expect(html).not.toContain("verified person");
    expect(html).not.toContain("Your search, in your words");
    expect(html).not.toContain("Built in community. Seen in context.");
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
    ).toEqual(["Amina Wanjiku"]);
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
        query: " njeri ",
      }).map((profile) => profile.name),
    ).toEqual(["Njeri Kamau"]);
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

it("renders model evidence order independently from names and preserves missing-evidence limits",()=>{
 const html=renderToStaticMarkup(<EvidenceOrdering enabled count={3} ordering={false} onOrder={()=>{}} order={{text:"Evidence comparison",evaluatedCandidates:3,profiles:[{userId:"b",name:"Fictional B",reason:"More published testing details",missingEvidence:["Production experience unknown"]},{userId:"a",name:"Fictional A",reason:"Implementation notes without tests",missingEvidence:["Testing details missing"]}]}}/>);
 expect(html.indexOf('Fictional B')).toBeLessThan(html.indexOf('Fictional A'));
 expect(html).toContain('Production experience unknown');expect(html).toContain('not a ranking of all members or ability');expect(html).toContain('/dashboard/discover?profile=b');
});

it("labels mentor-statement citations separately from published contributions",()=>{
 const html=renderToStaticMarkup(<EvidenceOrdering enabled count={1} ordering={false} onOrder={()=>{}} order={{text:"Published evidence",evaluatedCandidates:1,profiles:[{userId:"a",name:"Fictional A",reason:"Documented change",missingEvidence:[],citations:[{kind:"journey",id:"j",version:2,url:"https://example.com/change"},{kind:"confirmation",id:"c",version:2,url:null}]}]}}/>);
 expect(html).toContain("Published contribution · Revision 2");expect(html).toContain("Mentor statement · Revision 2");expect(html).toContain("Cited evidence for Fictional A");
});

it("explains full-query evidence discovery", () => {
  const html = renderToStaticMarkup(<ScoutWorkspace profiles={[]} />);
  expect(html).toContain("We use your full description to find and compare published evidence.");
});
it("uses singular entry for one contribution", () => {
  const profile = { ...demoProfiles[0], claims: demoProfiles[0].claims.slice(0, 1) };
  const html = renderToStaticMarkup(<ScoutWorkspace profiles={[profile]} initialProfile={profile} />);
  expect(html).toContain("1 entry");
  expect(html).not.toContain("1 entries");
});

it("uses singular and plural confirmed contribution counts", () => {
  expect(entryCountLabel(1, true)).toBe("1 confirmed entry");
  expect(entryCountLabel(0, true)).toBe("0 confirmed entries");
  expect(entryCountLabel(2)).toBe("2 entries");
});
