import {describe,it,expect} from "vitest";
import {memberProfileHref} from "./links";
describe("member links before the directory route ships",()=>{
 it("links only to an eligible public profile",()=>{
  expect(memberProfileHref({handle:"wanjiku",onPublicSite:true})).toBe("/talent/wanjiku");
  expect(memberProfileHref({handle:"wanjiku",onPublicSite:false})).toBeNull();
  expect(memberProfileHref({handle:"wanjiku"})).toBeNull();
 });
});
