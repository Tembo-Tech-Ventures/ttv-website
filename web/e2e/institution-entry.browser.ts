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
    await expect(page.getByText('Up to 50 matching profiles, alphabetical; refine filters', {exact:false})).toBeVisible();
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

test('restricted QA navigation omits blocked destinations and retains community', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/institution-entry.html?role=institution&qa=1');
  for (const name of ['Apply', 'Ask AI', 'Account', 'Logout']) await expect(page.getByRole('link',{name,exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Discover',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'About the community',exact:true})).toHaveAttribute('href','/community/members');
});

test('scout Back, Forward and refresh preserve submitted criteria without URL opportunity text', async ({page}) => {
  await page.setViewportSize({width:390,height:1000});
  await page.goto('/?view=scout');
  await expect(page.getByRole('link',{name:'Dashboard ↗',exact:true})).toBeVisible();
  await page.getByLabel('What are you working on?').fill('Fictional accessible product');
  await page.getByLabel('Skills to explore').fill('React');
  await page.getByRole('button',{name:'Discover people',exact:true}).click();
  await expect(page).toHaveURL(/skills=React/);
  expect(page.url()).not.toContain('Fictional');
  await page.getByRole('button',{name:"Explore Amina's work"}).click();
  await expect(page).toHaveURL(/profile=/);
  await expect(page.getByRole('heading',{name:'Amina Wanjiku',exact:true})).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading',{name:'2 builders to get to know'})).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading',{name:'Amina Wanjiku',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Amina Wanjiku',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to people',exact:true}).click();
  await page.getByRole('button',{name:'Edit criteria',exact:true}).click();
  await expect(page.getByLabel('Skills to explore')).toHaveValue('React');
  await expect(page.getByLabel('What are you working on?')).toHaveValue('Fictional accessible product');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed history restoration keeps filters recoverable', async ({page}) => {
  await page.goto('/?view=scout&fail=1&scout=results&skills=React');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'Edit criteria',exact:true}).click();
  await expect(page.getByLabel('Skills to explore')).toHaveValue('React');
  await expect(page.getByRole('button',{name:'Discover people',exact:true})).toBeEnabled();
});
