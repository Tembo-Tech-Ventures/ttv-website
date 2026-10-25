import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { publicKeyFingerprint, sealEnvelope, sealQaHandoff } from './staging-persona-qa-envelope.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const payload={personas:{mentor:[{name:'fictional-test-cookie',value:'fictional-local-only-secret'}]}};
const metadata={runId:'a'.repeat(24),issuedAt:1792920000,expiresAt:1792923600,version:'b'.repeat(40)};
function decrypt(envelope,privateKey=keys.privateKey){
 const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64'));
 const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));cipher.setAAD(Buffer.from(envelope.aad,'base64'));cipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ct,'base64')),cipher.final()]).toString());
}
describe('encrypted persona QA handoff',()=>{
 it('round trips four-cookie-shaped payload without plaintext in envelope',()=>{
  const e=sealEnvelope(payload,keys.publicKey,metadata);expect(decrypt(e)).toEqual(payload);
  expect(JSON.stringify(e)).not.toContain('fictional-local-only-secret');expect(Buffer.from(e.iv,'base64')).toHaveLength(12);expect(Buffer.from(e.tag,'base64')).toHaveLength(16);
  expect(JSON.parse(Buffer.from(e.aad,'base64').toString())).toMatchObject(metadata);
 });
 it.each(['aad','tag','ct','wrappedKey'])('rejects modified %s',field=>{const e=sealEnvelope(payload,keys.publicKey,metadata);const bytes=Buffer.from(e[field],'base64');bytes[0]^=1;e[field]=bytes.toString('base64');expect(()=>decrypt(e)).toThrow(/.*/);});
 it('pins production recipient independently of payload metadata',()=>{
  expect(publicKeyFingerprint(keys.publicKey)).toMatch(/^[a-f0-9]{64}$/);expect(()=>sealQaHandoff(payload,keys.publicKey,metadata)).toThrow('fingerprint mismatch');
 });
});

it('binds origin and all four personas and enforces the pinned handoff lifetime/cookie shape',()=>{
 const pem=JSON.parse(readFileSync(new URL('./staging-persona-qa-recipient.json',import.meta.url),'utf8')).publicKeyPem;
 const personas=Object.fromEntries(['member-cohort','member-noncohort','mentor','institution'].map(name=>[name,[{name:'__Host-ttv-retained-qa',value:'a'.repeat(64),url:'https://staging.tembotechventures.com',httpOnly:true,secure:true,sameSite:'Lax',expires:metadata.expiresAt}]]));
 const e=sealQaHandoff({personas},pem,metadata);const aad=JSON.parse(Buffer.from(e.aad,'base64').toString());expect(aad.origin).toBe('https://staging.tembotechventures.com');expect(aad.personas).toHaveLength(4);
 expect(()=>sealQaHandoff({personas},pem,{...metadata,expiresAt:metadata.issuedAt+7200})).toThrow('lifetime');
 personas.mentor[0].url='https://example.com';expect(()=>sealQaHandoff({personas},pem,metadata)).toThrow('cookie envelope');
});
