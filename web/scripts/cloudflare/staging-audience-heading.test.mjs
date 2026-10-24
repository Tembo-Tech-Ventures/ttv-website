import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import JourneyWorkspace from "../../src/components/community/JourneyWorkspace";
import ScoutWorkspace from "../../src/components/discovery/ScoutWorkspace";
import CommunityDemo from "../../src/components/community/CommunityDemo";
import { demoProfiles } from "../../src/components/discovery/fixtures";
import { expectAudienceHeading } from "./staging-audience-verification.mjs";

describe("rendered audience workspace headings",()=>{
  it.each([
    [JourneyWorkspace,{profile:demoProfiles[0],demo:true},"Your work. Your story."],
    [ScoutWorkspace,{profiles:demoProfiles,demo:true},"Find the person. See the work."],
    [CommunityDemo,{view:"mentor"},"Recognise the work. Name what you saw."],
  ])("normalizes real SSR line-break markup for %s",async(Component,props,expected)=>{
    const html=renderToStaticMarkup(React.createElement(Component,props));
    const heading=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1];
    expect(heading).toContain("<br/>");
    const text=heading.replace(/<[^>]*>/g, "");
    expect(text).not.toBe(expected);
    await expectAudienceHeading({textContent:async()=>text},expected);
  });
});
