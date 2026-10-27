// Narrated walkthrough of homepage candidate A. Record with:
//   node scripts/homepage-lab/record.mjs scripts/homepage-lab/tours/a.mjs ../.homepage-lab/videos/candidate-a-kinetic-editorial.mp4
const student = (text) => ({ id: "student", text });
const mentor = (text) => ({ id: "mentor", text });
const partner = (text) => ({ id: "partner", text });
const client = (text) => ({ id: "client", text });
const juror = (text) => ({ id: "juror", text });

export default {
  path: "/preview/home/a",
  label: "Candidate A · Kinetic editorial",
  segments: [
    {
      device: "laptop",
      async run(t) {
        await t.card({
          small: "Homepage candidate A",
          title: "Kinetic editorial: the type is the image.",
          body: "Big, balanced headlines on a calm twelve-column grid. Every motion is typographic: words rise, outlines fill, and the running cohort’s 04 carries you down the page. Three build rounds, two persona critiques and a release check.",
        });
        await t.pause(4200);
        await t.reload();
        await t.hideCard();
        await t.caption({
          chapter: "1 · Cohorts first",
          title: "Say what we do, in one sentence.",
          body: "The headline is the cohort programme. The giant outlined 04 is Cohort 04, running now.",
          why: [
            "The words rise in pure CSS, so the hero is never blank on slow data.",
            "Headline size follows the window height: Apply and “No degree required.” stay above the fold even on a 1366×657 laptop.",
          ],
          personas: [student("what a cohort is, that she qualifies, where to apply")],
        });
        await t.pause(4200);
        await t.caption({
          chapter: "1 · Cohorts first",
          title: "The running cohort joins the history.",
          body: "Scroll, and the headline shears apart while the 04 travels down into its slot in the cohort strip. It lands with a fill beat as 01 to 03 fill in ahead of it.",
          personas: [juror("the page’s own idea, not a stock effect")],
        });
        await t.scrollBy(260, 1800);
        await t.pause(500);
        await t.scrollBy(260, 1800);
        await t.pause(500);
        await t.scrollBy(260, 1800);
        await t.pause(1400);
        await t.moveTo(".is-live .cohort-num", 1000);
        await t.pause(1600);
        await t.caption({
          chapter: "1 · Cohorts first",
          title: "How a cohort works.",
          body: "Three columns on one rule: build together, engineers alongside, stay in touch. A peach line draws across them as you read.",
          personas: [mentor("engineers are part of the method, not decoration"), student("she won’t learn alone")],
        });
        await t.scrollBy(420, 2200);
        await t.pause(2000);
        await t.caption({
          chapter: "2 · Builders",
          title: "A gallery of real work.",
          body: "Vertical scroll drives a horizontal track of published graduates: what they built, in what, with which skills. The counter and bar always agree.",
          why: ["Fictional local fixtures here; production shows real graduates.", "A “View” disc follows the pointer; outlined monograms fill on hover."],
          personas: [partner("evidence of work, not a template")],
        });
        await t.scrollTo("#builders", 2000, 0);
        await t.pause(900);
        await t.moveTo("[data-ha-card]", 900);
        for (let i = 0; i < 6; i += 1) {
          await t.scrollBy(300, 1300);
          await t.pause(350);
        }
        await t.pause(1200);
        await t.caption({
          chapter: "3 · Community",
          title: "Not in a cohort? Three ways in.",
          body: "Builder, mentor, institutional partner, as large editorial rows. Everything reads at rest; hover or focus adds a peach wipe, the role slides and the arrow turns.",
          why: ["Mentor and partner access is approved by the team, and each row says so."],
          personas: [mentor("one clear row and action"), partner("a direct path to talent")],
        });
        await t.scrollTo("#community", 2400, 60);
        await t.pause(1200);
        await t.moveTo("#community .path >> nth=0", 900);
        await t.pause(1500);
        await t.moveTo("#community .path >> nth=1", 900);
        await t.pause(1700);
        await t.moveTo("#community .path >> nth=2", 900);
        await t.pause(1500);
        await t.caption({
          chapter: "4 · Hire",
          title: "A warm sheet slides over.",
          body: "Hiring is the one peach moment on the page. It slides up over the community as it recedes, opens to full bleed, and the builders’ own skills drift behind.",
          personas: [client("an unmistakable next step: propose a project")],
        });
        await t.scrollTo("#hire", 2800, 40);
        await t.pause(1200);
        await t.moveTo("#hire [data-ha-magnetic]", 1000);
        await t.pause(600);
        await t.moveTo({ x: 560, y: 560 }, 500);
        await t.moveTo("#hire [data-ha-magnetic]", 600);
        await t.pause(1400);
        await t.caption({
          chapter: "5 · Principles",
          title: "The outlined words, finished filled.",
          body: "Each principle fills from outline to solid peach as it crosses the middle of the screen, and its commitment slides in beside it.",
          why: ["One size for all five, set by PHILOSOPHY and measured from the font: never cropped, never stretched.", "A browser test fails the build if any word is unreadable at any width."],
          personas: [student("EQUITY: no degree required"), juror("the closing beat")],
        });
        await t.scrollTo("#principles", 2400, 60);
        for (let i = 0; i < 7; i += 1) {
          await t.scrollBy(240, 1300);
          await t.pause(700);
        }
        await t.pause(1000);
      },
    },
    {
      device: "phone",
      async run(t) {
        await t.caption({
          chapter: "On a phone",
          title: "One thumb, five seconds.",
          body: "Headline, Apply and “No degree required.” on the first screen. The intro is CSS only: nothing waits on script over metered data.",
          personas: [student("understands the cohort before she scrolls")],
        });
        await t.reload();
        await t.pause(3200);
        await t.caption({
          chapter: "On a phone",
          title: "Builders as a native swipe track.",
          body: "On touch the gallery becomes a snap-scrolling track. Rows of the community give instant feedback when pressed.",
          personas: [partner("browses talent by touch")],
        });
        await t.scrollTo("#builders", 2600, 60);
        await t.pause(700);
        await t.swipe("[data-ha-track]", 300, 900);
        await t.swipe("[data-ha-track]", 300, 900);
        await t.scrollTo("#community", 2400, 60);
        await t.pause(800);
        await t.scrollTo("#principles", 3200, 60);
        await t.scrollBy(1100, 3600);
        await t.pause(800);
      },
    },
    {
      device: "laptop",
      async run(t) {
        await t.card({
          small: "Why candidate A",
          title: "Confident type, calm grid, motion that means something.",
          body: "Wanjiku sees cohorts and that she qualifies above the fold. David sees engineers in the method. Grace scrolls a gallery of real work. Tomás gets one warm next step. Every word passes the readability test at 390, 820, 1440 and 1920 px, by keyboard and with reduced motion.",
        });
        await t.pause(7000);
      },
    },
  ],
};
