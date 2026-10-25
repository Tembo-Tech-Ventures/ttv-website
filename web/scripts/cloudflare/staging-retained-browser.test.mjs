import { createServer } from 'node:http';
import { request as playwrightRequest } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { retainedBrowserRoute } from './staging-retained-browser.mjs';
async function listen(handler){const server=createServer(handler);await new Promise(resolve=>{server.listen(0,'127.0.0.1',resolve);});return {server,origin:`http://127.0.0.1:${server.address().port}`};}
async function close(server){server.closeAllConnections();await new Promise(resolve=>{server.close(resolve);});}
const actor={personalAccessToken:'fictional-local-regression-only'};
function routeFor(url,method='GET') {return {request:()=>({url:()=>url,method:()=>method,headers:()=>({authorization:'inherited-fictional',cookie:'fictional-cookie',accept:'application/json'})}),abort:vi.fn(),continue:vi.fn(),fulfill:vi.fn(),fetch:vi.fn()};}
describe('retained browser credential confinement',()=>{
 it.each([301,302,303,307,308])('never follows authenticated HTTP%s to another origin',async status=>{
  let secondRequests=0,firstAuthorized=false;
  const second=await listen((req,res)=>{secondRequests++;res.end('must not reach');});
  const first=await listen((req,res)=>{firstAuthorized=req.headers.authorization===`Bearer ${actor.personalAccessToken}`;res.writeHead(status,{Location:`${second.origin}/capture`});res.end();});
  const client=await playwrightRequest.newContext();
  try{
   const url=`${first.origin}/api/community/profiles`,route=routeFor(url);
   route.fetch.mockImplementation(options=>client.fetch(url,options));
   await retainedBrowserRoute({baseUrl:first.origin},actor)(route);
   expect(firstAuthorized).toBe(true);expect(secondRequests).toBe(0);expect(route.abort).toHaveBeenCalledOnce();expect(route.fulfill).not.toHaveBeenCalled();
   expect(route.fetch).toHaveBeenCalledWith(expect.objectContaining({maxRedirects:0,maxRetries:0}));
  }finally{await client.dispose();await close(first.server);await close(second.server);}
 });
 it.each([['POST','/api/community/profile'],['GET','/api/community/mentorship'],['POST','/dashboard/discover'],['GET','/api/community/profiles/real'],['POST','/api/community/profiles/ttv-staging-demo-v1-member-cohort/assessment']])('denies unlisted %s %s before authentication',async(method,path)=>{
  const route=routeFor(`https://staging.tembotechventures.com${path}`,method);
  await retainedBrowserRoute({baseUrl:'https://staging.tembotechventures.com'},actor)(route);
  expect(route.abort).toHaveBeenCalledOnce();expect(route.fetch).not.toHaveBeenCalled();
 });
 it('strips inherited auth from assets and aborts third-party traffic',async()=>{
  const route=routeFor('https://staging.tembotechventures.com/_astro/app.js');
  await retainedBrowserRoute({baseUrl:'https://staging.tembotechventures.com'},actor)(route);
  expect(route.continue).toHaveBeenCalledWith({headers:{accept:'application/json'}});expect(route.fetch).not.toHaveBeenCalled();
  const external=routeFor('https://example.com/api/community/profiles');await retainedBrowserRoute({baseUrl:'https://staging.tembotechventures.com'},actor)(external);expect(external.abort).toHaveBeenCalledOnce();expect(external.fetch).not.toHaveBeenCalled();
 });
});
