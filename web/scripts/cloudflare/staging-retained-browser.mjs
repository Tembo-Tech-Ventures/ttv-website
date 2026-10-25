import { chromium } from '@playwright/test';
/** Real first-party UI/API only. Never attach PAT to assets, third parties or auth routes. */
export async function verifyRetainedBrowser({target,actor,query='Kotlin',browserType=chromium}) {
 const browser=await browserType.launch({headless:true});let context;
 try{
  context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==target.baseUrl)return route.abort();
   const allowed=(url.pathname==='/dashboard/discover'&&request.method()==='GET')||url.pathname.startsWith('/api/community/');
   if(!allowed && (url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/')))return route.abort();
   return route.continue({headers:{...request.headers(),...(allowed?{authorization:`Bearer ${actor.personalAccessToken}`}:{})}});
  });
  const page=await context.newPage();let errors=0;page.on('pageerror',()=>{errors++;});
  await page.goto(`${target.baseUrl}/dashboard/discover`,{waitUntil:'networkidle',timeout:30000});
  await page.getByLabel('What are you working on?').fill(`Fictional demo opportunity: ${query} implementation and testing. Compare published work evidence; identify documentation gaps. This is not a real hiring decision.`);
  await page.getByLabel('Skills to explore',{exact:false}).fill(query);
  await page.getByLabel('Already have someone in mind?').fill(query);
  await page.getByRole('button',{name:'Discover people',exact:true}).click();
  const order=page.getByRole('button',{name:'Order by published evidence',exact:true});await order.waitFor({timeout:20000});
  const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/community/chat'&&r.request().method()==='POST',{timeout:75000});
  const start=globalThis.performance.now();await order.click();const response=await responsePromise;const data=await response.json();const latencyMs=Math.round(globalThis.performance.now()-start);
  if(response.status()!==200||!data.grounded||!data.orderedProfiles?.length)throw new Error('Evidence order unavailable.');
  await page.getByText(/AI-generated evidence order/).waitFor({timeout:10000});
  const screenshots=[];
  for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
   await page.setViewportSize(viewport);await page.waitForTimeout(250);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);
   if(overflow||errors)throw new Error('Browser evidence check failed.');
   screenshots.push({name,buffer:await page.screenshot({fullPage:true})});
  }
  return {status:response.status(),data,latencyMs,screenshots};
 }finally{await context?.close();await browser.close();}
}
