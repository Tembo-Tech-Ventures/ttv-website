import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`member edits preserve revision history at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.goto('/member-edit.html?private');
 await page.getByRole('button',{name:'Edit Made a community library easier to use',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Edit your contribution',exact:true})).toBeVisible();
 await expect(page.getByLabel('Entry title', {exact:true})).toHaveValue('Made a community library easier to use');
 await expect(page.getByText('Saving keeps this contribution private.',{exact:false})).toBeVisible();
 await page.getByLabel('Entry title',{exact:true}).fill('Improved library keyboard navigation');
 await page.getByRole('button',{name:'Save changes',exact:true}).dblclick();
 await expect(page.getByRole('heading',{name:'Improved library keyboard navigation',exact:true})).toBeVisible();
 await expect(page.getByText('Previous revision checked by Grace Njeri',{exact:true})).toBeVisible();
 await expect(page.getByText('Review needed for current revision 2',{exact:false})).toBeVisible();
 await expect(page.getByText('Unpublished draft · Only you can see this contribution.',{exact:true})).toBeVisible();
 await expect(page.getByRole('status',{name:'Update calls'})).toHaveText('1');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`../docs/hackathon/member-edit-2026-10-25/edited-${width}.png`,fullPage:true});
});
test('a stale edit keeps the draft and asks for reload',async({page})=>{
 await page.goto('/member-edit.html?conflict');await page.getByRole('button',{name:'Edit Made a community library easier to use',exact:true}).click();await page.getByLabel('Entry title',{exact:true}).fill('Unsaved changed title');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Reload before editing');await expect(page.getByLabel('Entry title',{exact:true})).toHaveValue('Unsaved changed title');await expect(page.getByRole('heading',{name:'Made a community library easier to use',exact:true})).toBeVisible();
});
