import { describe, it, expect, vi } from "vitest";
import { audienceRoutesPresent, verifyAudienceAccess } from "./staging-audience-verification.mjs";
function fixture(fault) {
  const pages = [], visits = [];
  const context = role => ({ newPage: async () => {
    let audience, destination, expected;
    const page = { close: vi.fn(async()=>{if(fault==="close")throw new Error("PRIVATE");}), setViewportSize:vi.fn(),
      goto:vi.fn(async url=>{
        audience=url.split("/").at(-1);visits.push({role,audience});
        destination={members:"/dashboard/community",mentors:"/dashboard/mentorship",institutions:"/dashboard/discover"}[audience];
        expected=role==="anonymous"?"Sign in to Tembo.":audience==="members"?"Your work. Your story.":role==="member"?(audience==="mentors"?"Mentor access needs approval.":"Institutional access needs approval."):(audience==="mentors"?"Recognise the work. Name what you saw.":"Find the person. See the work.");
        return {status:()=>fault==="missing-route"?404:200};
      }), waitForURL:vi.fn(async url=>{expect(url).toBe(`https://staging.tembotechventures.com${role==="anonymous"?`/auth/login?next=${encodeURIComponent(destination)}`:destination}`);}),
      getByRole:vi.fn((kind,options)=>{
        if(kind==="heading")return {waitFor:async()=>{},textContent:async()=>fault==="wrong-heading"?"PRIVATE":expected};
        const link={first:()=>link,click:vi.fn(),getAttribute:async()=>fault==="wrong-link"?"https://example.com":options.name==="Go to your journey"?"/dashboard/community":role==="anonymous"?`/auth/login?next=${encodeURIComponent(destination)}`:destination};return link;
      }),locator:vi.fn(()=>page),
    };pages.push(page);return page;
  }});
  return {pages,visits,options:{baseUrl:"https://staging.tembotechventures.com",contextsByRole:Object.fromEntries(["member","mentor","institution","admin"].map(role=>[role,context(role)])),anonymousContext:context("anonymous"),users:Object.fromEntries(["member","mentor","institution","admin"].map(role=>[role,{userId:`ttv-staging-fixture-${"a".repeat(24)}-${role}`}]))}};
}
describe("audience activation and role navigation",()=>{
  it("activates only for a complete integrated route set",()=>{
    expect(audienceRoutesPresent(()=>false)).toBe(false);expect(audienceRoutesPresent(()=>true)).toBe(true);
    expect(()=>audienceRoutesPresent(url=>url.pathname.endsWith("members.astro"))).toThrow("integrated together");
  });
  it("checks anonymous, eligible, admin and missing-role desktop/mobile journeys and closes all pages",async()=>{
    const f=fixture();await verifyAudienceAccess(f.options);expect(f.visits).toHaveLength(22);
    expect(f.pages.every(p=>p.locator.mock.calls.some(([selector])=>selector===".audience-hero"))).toBe(true);
    expect(f.visits.filter(v=>v.role==="anonymous")).toHaveLength(6);
    expect(f.visits.filter(v=>v.role==="admin").map(v=>v.audience)).toEqual(["members","mentors","institutions","members","mentors","institutions"]);
    expect(f.pages.every(p=>p.close.mock.calls.length===1)).toBe(true);
    expect(f.pages.map(p=>p.setViewportSize.mock.calls[0][0].width)).toEqual([...Array(11).fill(1440),...Array(11).fill(390)]);
  });
  it.each(["wrong-link","wrong-heading","missing-route","close"])("fails closed and sanitizes %s",async fault=>{
    const f=fixture(fault);await expect(verifyAudienceAccess(f.options)).rejects.toThrow(fault==="close"?"Synthetic audience page cleanup failed":"Synthetic audience access verification failed");
    expect(f.pages.every(p=>p.close.mock.calls.length===1)).toBe(true);
  }, 10000);
  it.each(["missing", "mixed-run"])("rejects %s admin before browser activity",async fault=>{
    const f=fixture();
    if(fault==="missing")delete f.options.contextsByRole.admin;
    else f.options.users.admin.userId=`ttv-staging-fixture-${"b".repeat(24)}-admin`;
    await expect(verifyAudienceAccess(f.options)).rejects.toThrow(/Synthetic admin/);expect(f.pages).toHaveLength(0);
  });
  it("rejects non-staging and mixed-run identities before browser activity",async()=>{
    const f=fixture();f.options.baseUrl="https://example.com";await expect(verifyAudienceAccess(f.options)).rejects.toThrow("Expected values to be strictly equal");expect(f.pages).toHaveLength(0);
  });
});
