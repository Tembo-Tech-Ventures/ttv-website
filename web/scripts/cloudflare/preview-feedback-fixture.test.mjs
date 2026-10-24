import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { withPreviewFeedbackWriter } from "./preview-feedback-fixture.mjs";
const name = "agent-pr-171-1", version = "a".repeat(40), uuid = "11111111-1111-1111-1111-111111111111";
function fixture() {
  const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON");
  const directory = new URL("../../src/lib/db/migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(value => value.endsWith(".sql")).toSorted()) db.exec(readFileSync(new URL(file, directory), "utf8"));
  const environment = { EXPECTED_DEPLOYMENT_ENVIRONMENT: name, CLOUDFLARE_ENVIRONMENT_NAME: name, EXPECTED_DEPLOYMENT_VERSION: version, PLAYWRIGHT_BASE_URL: `https://ttv-website-${name}.preview.workers.dev` };
  const bindings = [{ name: "AGENT_AUTH_ENABLED", text: "true" },{ name: "DB", type: "d1", id: uuid }, { name: "BUCKET", type: "r2_bucket", bucket_name: `ttv-website-files-${name}` }, { name: "DEPLOYMENT_ENVIRONMENT", text: name }, { name: "DEPLOYMENT_VERSION", text: version }, { name: "BETTER_AUTH_URL", text: environment.PLAYWRIGHT_BASE_URL }];
  const api = vi.fn(async (path, options) => {
    if (path === "/workers/subdomain") return { subdomain: "preview" };
    if (path.endsWith("/settings")) return { bindings };
    if (path === `/d1/database/${uuid}`) return { uuid, name: `ttv-website-db-${name}` };
    const { sql, params } = options.body;
    return [{ results: sql.startsWith("SELECT") ? db.prepare(sql).all(...params) : (db.prepare(sql).run(...params), []) }];
  });
  const removeObject = vi.fn();
  const options = { environment, api, removeObject, fetchImpl: async () => Response.json({ service: "ttv-website", environment: name, version, checks: { db: "ok" } }) };
  return { db, options, bindings };
}
function insertFeedback(db, userId, id) {
  db.prepare("INSERT INTO feedback(id,userId,kind,message,pageUrl) VALUES(?,?,'BUG','fictional note','/dashboard')").run(id,userId);
  db.prepare("INSERT INTO feedback_attachment(id,feedbackId,objectKey,contentType,size,source,position) VALUES(?,?,?,'image/png',10,'CAPTURE',0)").run(`${id}-attachment`,id,`feedback/${id}/image.png`);
}
describe("isolated per-invocation feedback writer", () => {
  it.each([false,true])("cleans only its own rows/objects after child failure=%s", async failed => {
    const f=fixture();
    try {
      f.db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,1,1)').run("retained","Retained fictional user","retained@invalid.ttv");
      insertFeedback(f.db,"retained","historical");
      let ownId;
      const action=withPreviewFeedbackWriter({...f.options,run:async token=>{
        const session=f.db.prepare("SELECT * FROM session WHERE token=?").get(token); ownId=session.userId;
        expect(session.expiresAt-session.createdAt).toBe(3600);
        expect(f.db.prepare("SELECT * FROM UserRoles WHERE userId=?").all(ownId)).toHaveLength(0);
        insertFeedback(f.db,ownId,"current");
        if(failed)throw new Error("browser failure");
      }});
      if(failed)await expect(action).rejects.toThrow("browser failure");else await action;
      expect(f.options.removeObject.mock.calls).toEqual([[`ttv-website-files-${name}`,"feedback/current/image.png"]]);
      expect(f.db.prepare("SELECT id FROM user WHERE id=?").get(ownId)).toBeUndefined();
      expect(f.db.prepare("SELECT id FROM session").all()).toHaveLength(0);
      expect(f.db.prepare("SELECT id FROM feedback").all()).toEqual([{id:"historical"}]);
      expect(f.db.prepare("SELECT id FROM feedback_attachment").all()).toEqual([{id:"historical-attachment"}]);
      expect(f.db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    }finally{f.db.close();}
  });
  it("uses new identity and token on every invocation",async()=>{
    const f=fixture();const seen=[];
    try{for(let i=0;i<2;i++)await withPreviewFeedbackWriter({...f.options,run:async token=>{seen.push([token,f.db.prepare("SELECT userId FROM session WHERE token=?").get(token).userId]);}});
      expect(seen[0][0]).not.toBe(seen[1][0]);expect(seen[0][1]).not.toBe(seen[1][1]);
    }finally{f.db.close();}
  });
  it.each(["staging","production","agent-INVALID"])("rejects %s before API/writes",async invalid=>{
    const f=fixture();try{await expect(withPreviewFeedbackWriter({...f.options,environment:{...f.options.environment,EXPECTED_DEPLOYMENT_ENVIRONMENT:invalid},run:vi.fn()})).rejects.toThrow("target rejected");expect(f.options.api).not.toHaveBeenCalled();}finally{f.db.close();}
  });
  it.each(["AGENT_AUTH_ENABLED","DB","BUCKET","DEPLOYMENT_ENVIRONMENT","DEPLOYMENT_VERSION","BETTER_AUTH_URL"])("rejects mismatched %s before writes",async key=>{
    const f=fixture();try{f.bindings.find(item=>item.name===key).name="wrong";await expect(withPreviewFeedbackWriter({...f.options,run:vi.fn()})).rejects.toThrow("preflight");expect(f.db.prepare("SELECT id FROM user").all()).toHaveLength(0);}finally{f.db.close();}
  });
  it.each(["object-failure","foreign-key"])("revokes session but retains rows on %s",async mode=>{
    const f=fixture();try{
      if(mode==="object-failure")f.options.removeObject.mockRejectedValue(new Error("sensitive provider error"));
      await expect(withPreviewFeedbackWriter({...f.options,run:async()=>{
        const userId=f.db.prepare("SELECT userId FROM session").get().userId;insertFeedback(f.db,userId,"current");
        if(mode==="foreign-key")f.db.prepare("UPDATE feedback_attachment SET objectKey='feedback/another-owner/image.png'").run();
      }})).rejects.toThrow(mode==="object-failure"?"cleanup failed":"ownership rejected");
      expect(f.db.prepare("SELECT id FROM session").all()).toHaveLength(0);
      expect(f.db.prepare("SELECT id FROM feedback").all()).toHaveLength(1);
      if(mode==="foreign-key")expect(f.options.removeObject).not.toHaveBeenCalled();
    }finally{f.db.close();}
  });
  it("rejects stale health before writing", async () => {
    const f=fixture();try{await expect(withPreviewFeedbackWriter({...f.options,fetchImpl:async()=>Response.json({service:"ttv-website",environment:name,version:"b".repeat(40),checks:{db:"ok"}}),run:vi.fn()})).rejects.toThrow("preflight");expect(f.db.prepare("SELECT id FROM user").all()).toHaveLength(0);}finally{f.db.close();}
  });
  it.each(["https://staging.tembotechventures.com", "https://attacker.test", "https://user:password@ttv-website-agent-pr-171-1.preview.workers.dev"])("rejects wrong or credentialed origin", async base => {
    const f=fixture();try{await expect(withPreviewFeedbackWriter({...f.options,environment:{...f.options.environment,PLAYWRIGHT_BASE_URL:base},run:vi.fn()})).rejects.toThrow("preflight");expect(f.db.prepare("SELECT id FROM user").all()).toHaveLength(0);}finally{f.db.close();}
  });
  it("cleans a partially provisioned user and sanitizes database errors", async () => {
    const f=fixture();const original=f.options.api;try{
      const api=async(path,options)=>{if(options?.body?.sql.startsWith("INSERT INTO session"))throw new Error("sensitive token in SQL");return original(path,options);};
      await expect(withPreviewFeedbackWriter({...f.options,api,run:vi.fn()})).rejects.toThrow("database operation failed");
      expect(f.db.prepare("SELECT id FROM user").all()).toHaveLength(0);
    }finally{f.db.close();}
  });

});
