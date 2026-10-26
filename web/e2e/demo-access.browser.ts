import { test,expect } from "@playwright/test";
for(const width of [390,1440]) {
 test(`demo chooser and safe return controls at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await page.goto('/demo-access.html');
  await expect(page.getByRole('heading',{name:'Choose a demo role'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Cohort member/})).toBeVisible();
  await expect(page.getByRole('button',{name:/Community member/})).toBeVisible();
  await expect(page.getByRole('button',{name:/Mentor/})).toBeVisible();
  await expect(page.getByRole('button',{name:/Institution/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`../docs/demo-prep-2026-10-26/chooser-${width}.png`,fullPage:true});
  await page.goto('/demo-access.html?controls');
  await expect(page.getByText('Staging impersonation · Fictional demo profile')).toBeVisible();
  await page.getByRole('button',{name:'Stop impersonating · Return to admin'}).click();
  await expect(page.getByRole('button',{name:'Keep working'})).toBeFocused();
  await page.getByRole('button',{name:'Keep working'}).click();
  await expect(page.getByRole('button',{name:'Confirm return to admin'})).toHaveCount(0);
  await page.getByRole('button',{name:'Stop impersonating · Return to admin'}).click();
  await page.screenshot({path:`../docs/demo-prep-2026-10-26/return-${width}.png`,fullPage:true});
  let calls=0;
  await page.route('**/api/demo/return',async route=>{
   calls++;expect(route.request().method()).toBe('POST');expect(route.request().postDataJSON()).toEqual({});
   await route.fulfill({json:{redirectTo:'/admin'}});
  });
  await page.getByRole('button',{name:'Confirm return to admin'}).click();
  await expect(page).toHaveURL(/\/admin$/);expect(calls).toBe(1);
 });
}
