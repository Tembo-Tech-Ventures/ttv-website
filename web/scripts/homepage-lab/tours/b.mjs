// Narrated walkthrough of homepage candidate B. Record with:
//   node scripts/homepage-lab/record.mjs scripts/homepage-lab/tours/b.mjs ../.homepage-lab/videos/candidate-b-layers.mp4
const student = (text) => ({ id: "student", text });
const mentor = (text) => ({ id: "mentor", text });
const partner = (text) => ({ id: "partner", text });
const client = (text) => ({ id: "client", text });
const juror = (text) => ({ id: "juror", text });

export default {
  path: "/preview/home/b",
  label: "Candidate B · Layers",
  segments: [
    {
      device: "laptop",
      async run(t) {
        await t.card({
          small: "Homepage candidate B",
          title: "Layers: the page as a stack of sheets.",
          body: "Each section is a sheet that tips back as the next slides over it. The cohort deck in the hero becomes the motif all the way down: builders carry their cohort’s card, and hiring is one more pair of cards. Three build rounds, two persona critiques and a release check.",
        });
        await t.pause(4600);
        await t.reload();
        await t.hideCard();
        await t.caption({
          chapter: "1 · Cohorts first",
          title: "A deck of cohorts.",
          body: "The headline says what we do. Beside it, four cohort cards deal in: 01 to 03 complete, 04 on top and running now.",
          why: ["“No degree required.” and Apply sit together on the first screen.", "Each card carries that cohort’s real published builders."],
          personas: [student("sees cohorts are real, and produce real people")],
        });
        await t.pause(3600);
        await t.caption({
          chapter: "1 · Cohorts first",
          title: "Touch the deck.",
          body: "Move the pointer over it and the cards part and tilt toward you. Pick a cohort and it comes to the top with its builders; “Meet the builders” then jumps to that cohort in the builder file.",
          personas: [juror("tactile, and it means something"), partner("from a cohort to its people in one click")],
        });
        await t.moveTo("[data-hb-deck-stage]", 1000);
        for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.35], [0.65, 0.7], [0.35, 0.65], [0.5, 0.5]]) {
          await t.moveTo(await t.point("[data-hb-deck-stage]", fx, fy), 650);
        }
        await t.pause(600);
        // Each card's visible strip is its top edge; the rest sits under the cards in front.
        await t.click(await t.point('[data-cohort="02"] [data-hb-deck-button]', 0.4, 0.04));
        await t.pause(2400);
        await t.click(await t.point('[data-cohort="01"] [data-hb-deck-button]', 0.4, 0.04));
        await t.pause(2200);
        await t.click(await t.point('[data-cohort="04"] [data-hb-deck-button]', 0.4, 0.04));
        await t.pause(1600);
        await t.caption({
          chapter: "2 · Builders",
          title: "The signature move: sheets that tip back.",
          body: "Scroll and the hero sheet tips back, shrinks and dims while the builders sheet rises over it. No dead holds: something always answers your scroll.",
          personas: [juror("depth you can feel, and it never slows reading")],
        });
        await t.scrollBy(380, 2400);
        await t.pause(400);
        await t.scrollBy(380, 2400);
        await t.pause(900);
        await t.caption({
          chapter: "2 · Builders",
          title: "A card file of people.",
          body: "Each builder card sticks just below the last, so the ones you have passed stay readable as an index of names and cohorts. Headline, project and skills on each card.",
          why: ["Fictional local fixtures here; production shows real graduates."],
          personas: [partner("browses real work quickly, and can see everyone she passed")],
        });
        await t.scrollTo("#builders", 2200, 0);
        for (let i = 0; i < 8; i += 1) {
          await t.scrollBy(330, 1300);
          await t.pause(450);
        }
        await t.pause(800);
        await t.caption({
          chapter: "3 · Community",
          title: "Three ways in, shown with real content.",
          body: "A sliding tab for each role. The pictures are built from published profiles: the builder’s own project, a mentor note pinned to a real README, a partner search whose filters match its results.",
          why: ["Nothing is invented for anyone: captions say what is an illustration.", "Proper ARIA tabs, arrow keys included."],
          personas: [mentor("sees exactly what a mentor does"), partner("sees the path to talent")],
        });
        await t.scrollTo("#community", 2600, 0);
        await t.pause(1600);
        await t.click("#hb-tab-mentor");
        await t.pause(2600);
        await t.press("ArrowRight");
        await t.pause(2600);
        await t.press("ArrowLeft", 2, 1400);
        await t.pause(800);
        await t.caption({
          chapter: "4 · Hire",
          title: "The warm sheet.",
          body: "Hiring is the one peach sheet, filling the screen. Two cards — propose a project, browse builders — part and lift as you reach for them.",
          personas: [client("one obvious next step, and what happens after")],
        });
        await t.scrollTo("#hire", 2800, 0);
        await t.pause(1300);
        await t.moveTo("[data-hb-hire-card] >> nth=0", 900);
        await t.pause(1400);
        await t.moveTo("[data-hb-hire-card] >> nth=1", 900);
        await t.pause(1400);
        await t.caption({
          chapter: "5 · Principles",
          title: "The outlined words, stacked like sheets.",
          body: "Each principle is a card that rises and fills peach as it lands, with its commitment alongside.",
          why: ["One size for all five, measured from the font: never cropped, never stretched.", "A browser test fails the build if any word is unreadable at any width."],
          personas: [student("EQUITY: no degree required"), juror("the closing beat")],
        });
        await t.scrollTo("#principles", 2600, 0);
        for (let i = 0; i < 7; i += 1) {
          await t.scrollBy(280, 1300);
          await t.pause(650);
        }
        await t.pause(800);
        await t.caption({
          chapter: "Navigation",
          title: "Jump anywhere, land right.",
          body: "Sticky layouts usually break back-navigation. Here anchors, hash links and Shift+Tab all land on the real section, below the nav and never covered.",
          personas: [juror("keyboard and nav users are never lost")],
        });
        await t.frame.evaluate(() => { window.location.hash = "builders"; });
        await t.pause(2200);
        await t.frame.evaluate(() => { window.location.hash = "cohorts"; });
        await t.pause(2200);
      },
    },
    {
      device: "phone",
      async run(t) {
        await t.caption({
          chapter: "On a phone",
          title: "Calm on a small screen.",
          body: "Headline, Apply and “No degree required.” first; the deck sits below and never crowds the text. Sheets still stack as you scroll.",
          personas: [student("understands the cohort in five seconds")],
        });
        await t.reload();
        await t.pause(3200);
        await t.scrollBy(900, 2600);
        await t.pause(600);
        await t.scrollTo("#builders", 2400, 0);
        await t.scrollBy(1400, 4200);
        await t.pause(600);
        await t.caption({
          chapter: "On a phone",
          title: "Tabs work by touch.",
          body: "Tap a role; the panel assembles its picture from real profile content.",
          personas: [mentor("same clarity on a phone"), partner("same")],
        });
        await t.scrollTo("#community", 2400, 0);
        await t.pause(800);
        await t.tap("#hb-tab-partner");
        await t.pause(2200);
        await t.scrollTo("#principles", 3000, 0);
        await t.scrollBy(900, 3000);
        await t.pause(800);
      },
    },
    {
      device: "laptop",
      async run(t) {
        await t.card({
          small: "Why candidate B",
          title: "Tactile, layered, and grounded in real people.",
          body: "Wanjiku sees cohorts, that she qualifies, and that cohorts produce builders. David sees what a mentor actually does. Grace browses a card file of real work. Tomás gets a warm, full-screen next step. Every word passes the readability test at 390, 820, 1440 and 1920 px, by keyboard and with reduced motion.",
        });
        await t.pause(7000);
      },
    },
  ],
};
