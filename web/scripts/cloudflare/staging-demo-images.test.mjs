import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { buildDemoImageMapping, seedDemoImages } from "./staging-demo-images.mjs";
import { verifyStagingFixtureTarget, STAGING_FIXTURE_DATABASE_ID as databaseId } from "./staging-fixture-target.mjs";
const manifest = { version: 1, synthetic: true, portraits: Array.from({length:7}, (_,i)=>({src:`/images/demo/portrait-${String(i+1).padStart(2,"0")}.webp`,provenance:"AI-generated",alt:"AI-generated fictional adult portrait"})), contexts:[{src:"/images/demo/context-01.webp"}] };
const databases=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
async function fixture() {
 const db=new DatabaseSync(":memory:");databases.push(db);db.exec('CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT,image TEXT)');const writes=[];
 const version="b".repeat(40),accountId="a".repeat(32);
 const target=await verifyStagingFixtureTarget({environmentName:"staging",accountId,expectedVersion:version,baseUrl:"https://staging.tembotechventures.com",fetchImpl:async()=>Response.json({service:"ttv-website",environment:"staging",version,checks:{db:"ok"}}),api:async(path,options)=>{
  if(path==="")return{id:accountId};
  if(path.endsWith('/settings'))return{bindings:[{name:"DB",type:"d1",id:databaseId},{name:"DEPLOYMENT_ENVIRONMENT",text:"staging"},{name:"DEPLOYMENT_VERSION",text:version},{name:"PRIMARY_DOMAIN",text:"staging.tembotechventures.com"},{name:"BETTER_AUTH_URL",text:"https://staging.tembotechventures.com"}]};
  if(path.endsWith(databaseId))return{uuid:databaseId,name:"ttv-website-db-staging"};
  const{sql,params}=options.body;const statement=db.prepare(sql);if(sql.startsWith('SELECT'))return[{results:statement.all(...params)}];writes.push(sql);statement.run(...params);return[{results:[]}];
 }});return{db,target,writes};
}
it('maps only deterministic owned users to seven portrait paths',()=>{
 const mapping=buildDemoImageMapping(manifest);expect(mapping).toEqual(buildDemoImageMapping(manifest));expect(mapping).toHaveLength(150);expect(new Set(mapping.map(u=>u.image)).size).toBe(7);expect(mapping.every(u=>u.id.startsWith('ttv-staging-demo-v1-')&&!u.image.includes('context'))).toBe(true);
});
it('preserves human images, real users and absent users across repeated backfills',async()=>{
 const f=await fixture(),mapping=buildDemoImageMapping(manifest);
 for(const [i,image] of [[0,null],[1,''],[2,'https://example.com/human-edited.webp'],[3,'   ']])f.db.prepare('INSERT INTO user VALUES(?,?,?)').run(mapping[i].id,mapping[i].email,image);
 f.db.prepare('INSERT INTO user VALUES(?,?,?)').run('real','real@example.com',null);
 await seedDemoImages(f.target,manifest);await seedDemoImages(f.target,manifest);
 expect(f.db.prepare('SELECT image FROM user WHERE id=?').get(mapping[0].id).image).toBe(mapping[0].image);
 expect(f.db.prepare('SELECT image FROM user WHERE id=?').get(mapping[1].id).image).toBe(mapping[1].image);
 expect(f.db.prepare('SELECT image FROM user WHERE id=?').get(mapping[2].id).image).toBe('https://example.com/human-edited.webp');
 expect(f.db.prepare('SELECT image FROM user WHERE id=?').get(mapping[3].id).image).toBe('   ');
 expect(f.db.prepare('SELECT image FROM user WHERE id=?').get('real').image).toBeNull();expect(f.db.prepare('SELECT COUNT(*) n FROM user').get().n).toBe(5);
});
it('rejects identity collisions before all writes and rejects unverified targets/manifests',async()=>{
 const f=await fixture(),mapping=buildDemoImageMapping(manifest);f.db.prepare('INSERT INTO user VALUES(?,?,NULL)').run(mapping[149].id,'real@example.com');
 await expect(seedDemoImages(f.target,manifest)).rejects.toThrow('no record values');expect(f.writes).toHaveLength(0);
 await expect(seedDemoImages({},manifest)).rejects.toThrow('verified staging');
 expect(()=>buildDemoImageMapping({...manifest,synthetic:false})).toThrow('manifest');expect(()=>buildDemoImageMapping({...manifest,portraits:[...manifest.contexts]})).toThrow('manifest');
});
