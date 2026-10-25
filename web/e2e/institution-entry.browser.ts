import { test, expect } from "@playwright/test";
for (const width of [390, 1440]) {
  test(`institution navigation and alphabetical results at ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/institution-entry.html?role=institution');
    await expect(page.getByRole('link', {name: 'Discover builders', exact:true})).toHaveAttribute('href','/dashboard/discover');
    if(width < 1024) {
      await page.getByRole('button', {name: 'Open navigation'}).click();
      await expect.poll(async () => (await page.locator('[id^="headlessui-dialog-panel"]').boundingBox())?.x).toBe(0);
    }
    await expect(page.getByRole('link',{name:'Discover',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Community',exact:true})).toBeVisible();
    await page.screenshot({path:`../docs/hackathon/institution-entry-2026-10-25/navigation-${width}.png`,fullPage:true, animations:'disabled'});
    await page.goto('/?view=scout');
    await expect(page.getByText('This context informs evidence ordering, not directory skill matching.', {exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Discover people',exact:true}).click();
    await expect(page.getByText('Directory results are alphabetical', {exact:false})).toBeVisible();
    await expect(page.locator('.discovery-person-index')).toHaveCount(0);
    await expect(page.getByText('1 confirmed entry', {exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`../docs/hackathon/institution-entry-2026-10-25/results-${width}.png`,fullPage:true, animations:'disabled'});
  });
}
test('member navigation does not gain institution entry', async ({page})=> {
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/institution-entry.html?role=member');
  await expect(page.getByRole('link',{name:'Discover',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Find your next cohort'})).toBeVisible();
});
