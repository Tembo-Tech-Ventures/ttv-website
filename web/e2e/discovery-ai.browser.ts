import {test,expect} from '@playwright/test';
for(const width of [390,1440]) test(`full-query discovery and name lookup at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 const profile={userId:'grace',name:'Fictional Grace Wanjiku',image:null,headline:'Python developer',bio:'Python tools',skills:['Python'],opportunityGoals:'Field projects',version:1,updatedAt:1};
 let submissions=0;
 await page.route('**/api/community/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/access'))return route.fulfill({json:{isInstitution:true,isAdmin:false,isMentor:false}});
  if(path.endsWith('/profiles/discover')){
   submissions++;expect(route.request().postDataJSON()).toEqual({context:'Elephant tracking with Python and first-aid training',skills:'python, first-aid',query:''});
   return route.fulfill({json:{profiles:[{profile,matches:[{criterion:{text:'Python',importance:'required'},status:'supported'},{criterion:{text:'First-aid training',importance:'requested'},status:'supported'},{criterion:{text:'Elephant tracking',importance:'context'},status:'unknown'}]}],evaluated:20,searched:149}});
  }
  if(path.endsWith('/profiles'))return route.fulfill({json:{profiles:[profile]}});
  return route.fulfill({json:{profile,entries:[]}});
 });
 await page.goto('/?api=mock&view=scout');
 await page.getByLabel('What are you working on?').fill('Elephant tracking with Python and first-aid training');
 await page.getByLabel('Skills to explore').fill('python, first-aid');
 await page.getByRole('button',{name:'Discover people',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Fictional Grace Wanjiku'})).toBeVisible();
 await expect(page.getByText('Supported by published evidence',{exact:false})).toHaveCount(2);
 await expect(page.getByText('No published evidence found',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Order by published evidence'})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Find someone you know',exact:true}).click();
 await page.getByLabel('Name to look up').fill('Grace');
 await page.getByRole('button',{name:'Look up person',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Fictional Grace Wanjiku'})).toBeVisible();expect(submissions).toBe(1);
});
