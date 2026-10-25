import { Buffer } from 'node:buffer';
import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto';

export {QA_KEY_PIN as QA_KEY_FINGERPRINT} from '../../src/lib/staging-qa-config.mjs';
import {QA_KEY_PIN,QA_COOKIE} from '../../src/lib/staging-qa-config.mjs';
export const QA_ENVELOPE_ALGORITHM = 'RSA-OAEP-256+A256GCM';
export function publicKeyFingerprint(pem) {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072) throw new Error('Unsupported QA recipient key.');
  return createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
}
/** Pure primitive; production issuer must use sealQaHandoff and its pinned recipient. */
export function sealEnvelope(payload, pem, metadata) {
  const header = {v:1,alg:QA_ENVELOPE_ALGORITHM,runId:metadata.runId,issuedAt:metadata.issuedAt,expiresAt:metadata.expiresAt,version:metadata.version,origin:'https://staging.tembotechventures.com',personas:Object.keys(payload.personas??{}).toSorted()};
  const aad = Buffer.from(JSON.stringify(header));
  const plaintext = Buffer.from(JSON.stringify(payload));
  const key = randomBytes(32), iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext),cipher.final()]);
    return {...header,aad:aad.toString('base64'),
      wrappedKey:publicEncrypt({key:pem,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64'),
      iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ct:ciphertext.toString('base64')};
  } finally {key.fill(0);plaintext.fill(0);}
}
export function sealQaHandoff(payload, pem, metadata) {
  if (publicKeyFingerprint(pem) !== QA_KEY_PIN) throw new Error('QA recipient fingerprint mismatch.');
  if (!/^[a-f0-9]{24}$/.test(metadata.runId) || !/^[a-f0-9]{40}$/.test(metadata.version) ||
      !Number.isSafeInteger(metadata.issuedAt) || !Number.isSafeInteger(metadata.expiresAt) || metadata.expiresAt <= metadata.issuedAt ||
      metadata.expiresAt > Math.min(metadata.issuedAt+3600,Date.parse('2026-10-25T23:00:00Z')/1000)) throw new Error('Invalid QA handoff lifetime.');
  const names=['institution','member-cohort','member-noncohort','mentor'];
  if(JSON.stringify(Object.keys(payload.personas??{}).toSorted())!==JSON.stringify(names))throw new Error('Exactly four QA personas required.');
  for(const cookies of Object.values(payload.personas)){
    if(!Array.isArray(cookies)||cookies.length!==1)throw new Error('Invalid QA cookie envelope.');
    const c=cookies[0];if(c.name!==QA_COOKIE||!/^[a-f0-9]{64}$/.test(c.value)||c.url!=='https://staging.tembotechventures.com'||Object.hasOwn(c,'domain')||Object.hasOwn(c,'path')||c.secure!==true||c.httpOnly!==true||c.sameSite!=='Lax'||c.expires!==metadata.expiresAt)throw new Error('Invalid QA cookie envelope.');
  }
  return sealEnvelope(payload,pem,metadata);
}
