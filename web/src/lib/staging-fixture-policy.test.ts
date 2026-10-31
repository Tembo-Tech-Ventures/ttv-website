import { expect, it } from "vitest";
import { stagingFixturePathAllowed } from "./staging-fixture-policy";
it.each(["/admin","/api/admin/users","/api/recordings/private","/dashboard/portfolio","/api/auth/update-user","/api/mcp/other","/api/community-other"])("denies unrelated fixture surface %s", path=>{for(const method of ["GET","POST"])expect(stagingFixturePathAllowed(path,method)).toBe(false);});
it.each(["/dashboard/community","/dashboard/discover/","/dashboard/mentorship","/api/community/profile","/api/mcp","/_astro/app.js","/api/auth/get-session","/auth/logout"])("allows bounded community fixture surface %s", path=>{for(const method of ["GET","POST"])expect(stagingFixturePathAllowed(path,method)).toBe(true);});

it.each(["members","mentors","institutions"])("allows only exact public audience page %s", audience=>{
 expect(stagingFixturePathAllowed(`/community/${audience}`,"GET")).toBe(true);
 expect(stagingFixturePathAllowed(`/community/${audience}/`,"GET")).toBe(true);
 expect(stagingFixturePathAllowed(`/community/${audience}/private`,"GET")).toBe(false);
 expect(stagingFixturePathAllowed(`/community/${audience}-admin`,"GET")).toBe(false);
});
