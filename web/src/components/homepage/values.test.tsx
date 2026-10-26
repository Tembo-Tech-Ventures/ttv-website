import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BuildersSection from "./BuildersSection";
import HomeIntroduction from "./HomeIntroduction";
import { VALUES } from "./values";

const render = (isAuthenticated = false) => renderToStaticMarkup(<HomeIntroduction isAuthenticated={isAuthenticated} />);

describe("simplified homepage", () => {
  it("renders each commitment once, without a carousel, section numbering or stale cohort claims", () => {
    const html = render();
    for (const { word, commitment } of VALUES) {
      expect(html.split(word)).toHaveLength(2);
      expect(html.split(commitment.replaceAll("'", "&#x27;"))).toHaveLength(2);
    }
    expect(VALUES.map(({ word }) => word)).toEqual(["EQUITY", "CONTINUITY", "HONESTY"]);
    expect(html).not.toMatch(/§|carousel|Cohort in flight|internships so far|Swahili/);
    expect(html).toContain("No degree required");
    expect(html).toContain("not a promise of a job");
  });
  it("gives visitors one community action with a preserved login destination", () => {
    const html = render();
    expect(html).toContain('href="/auth/login?next=%2Fdashboard%2Fcommunity"');
    expect(html.split("Join the community")).toHaveLength(2);
    expect(html).toContain("Open with or without a cohort.");
    expect(html).toContain('href="/community"');
  });
  it("takes signed-in members straight to their journey", () => {
    const html = render(true);
    expect(html).toContain('href="/dashboard/community"');
    expect(html).toContain("Open my journey");
    expect(html).not.toContain("/auth/login");
  });
  it("offers three distinct audience routes and explains institutional approval", () => {
    const html = render();
    for (const audience of ["members", "mentors", "institutions"]) {
      expect(html.split(`href="/community/${audience}"`)).toHaveLength(2);
    }
    expect(html).toContain("Institutional access requires approval.");
    expect(html).toContain("Mentor access requires approval.");
    expect(html).not.toContain("invite mentors");
    expect(html).toContain("work you have actually checked");
    expect(html).toContain('aria-label="Find your place at Tembo"');
  });
  it("keeps existing incoming fragment links and a complete h1 accessible name", () => {
    const html = render();
    for (const id of ["what-we-do", "why-tembo", "values"]) expect(html).toContain(`id="${id}"`);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Tembo Tech Ventures"');
  });
  it("composes the real homepage without reintroducing legacy repeated sections or hydration", () => {
    const route = readFileSync(new URL("../../pages/index.astro", import.meta.url), "utf8");
    expect(route.match(/<HomeIntroduction\b/g)).toHaveLength(1);
    expect(route).not.toMatch(/CommunityIntro|FeaturesSection|ValuesSection|Marquee|ValueSection|client:/);
    expect(route).toContain("latestPosts.length > 0");
    expect(route).not.toContain("&sect;");
    const humans = readFileSync(new URL("./HumansSection.astro", import.meta.url), "utf8");
    expect(humans).toContain('id="humans"');
    expect(humans).toContain("<BuildersSection profiles={profileCards}");
    expect(humans).not.toMatch(/profiles land|&sect;/);
  });
});


describe("homepage builders", () => {
  it("omits an empty builder section instead of promising future profiles", () => {
    expect(renderToStaticMarkup(<BuildersSection profiles={[]} />)).toBe("");
  });
  it("renders eligible supplied profiles with named links and image or initials", () => {
    const html = renderToStaticMarkup(<BuildersSection profiles={[
      { handle: "fictional-amina", name: "Amina Example", image: null, initials: "AE", label: "Example cohort" },
      { handle: "fictional-kamau", name: "Kamau Example", image: "/example.png", initials: "KE", label: "" },
    ]} />);
    expect(html).toContain("Meet the builders.");
    expect(html).toContain('href="/talent/fictional-amina"');
    expect(html).toContain('aria-label="Meet Amina Example"');
    expect(html).toContain(">AE</span>");
    expect(html).toContain('src="/example.png"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('href="/talent"');
  });
});
