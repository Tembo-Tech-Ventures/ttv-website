// Narrated walkthrough of homepage candidate D. Record with:
//   node scripts/homepage-lab/record.mjs scripts/homepage-lab/tours/d.mjs ../.homepage-lab/videos/candidate-d-layers-mapped.mp4
const student = (text) => ({ id: "student", text });
const mentor = (text) => ({ id: "mentor", text });
const partner = (text) => ({ id: "partner", text });
const client = (text) => ({ id: "client", text });
const juror = (text) => ({ id: "juror", text });

export default {
  path: "/preview/home/d",
  label: "Candidate D · Layers, mapped",
  segments: [
    {
      device: "laptop",
      async run(t) {
        await t.card({
          small: "Homepage candidate D",
          title: "Layers, mapped: B’s stack of sheets, with a path through a map of skills.",
          body: "Built on candidate B, your favourite. It borrows C’s network language and adds a first picture of a skills map, in the spirit of École 42’s progression graph. The map is an illustration: TTV does not track anyone’s progress through it.",
        });
        await t.pause(5200);
        await t.reload();
        await t.hideCard();
        await t.caption({
          chapter: "1 · Cohorts first",
          title: "B’s hero, now standing on a map.",
          body: "The headline, Apply and “No degree required.” come first. Behind the cohort deck, faint rings draw in: the cohort sits at the centre of something larger.",
          why: ["Text paints in CSS before any script, so it reads instantly on slow data.", "The deck still parts and tilts, and each card carries that cohort’s published builders."],
          personas: [student("what a cohort is, that she qualifies, where to apply")],
        });
        await t.pause(3200);
        await t.moveTo("[data-hd-deck-stage]", 900);
        for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.4], [0.6, 0.7], [0.4, 0.55]]) {
          await t.moveTo(await t.point("[data-hd-deck-stage]", fx, fy), 600);
        }
        await t.click(await t.point('[data-cohort="02"] [data-hd-deck-button]', 0.4, 0.04));
        await t.pause(2000);
        await t.click(await t.point('[data-cohort="04"] [data-hd-deck-button]', 0.4, 0.04));
        await t.pause(1200);
        await t.caption({
          chapter: "2 · A map of skills",
          title: "Every skill opens onto the next.",
          body: "The map slides over the hero as its own sheet. A peach path walks outward from the centre: build together, engineers join, then the path crosses the cohort’s ring and keeps going.",
          why: ["Every skill on the map comes from builders’ published profiles; nothing is invented.", "No skill is marked as finished by anyone. It is a picture of a path, not a record."],
          personas: [student("sees learning as a path she walks with others"), juror("the page’s new idea, after 42’s holy graph")],
        });
        await t.scrollTo("[data-hd-map-stage]", 3200, 140);
        await t.pause(1500);
        await t.scrollBy(260, 1800);
        await t.pause(1400);
        await t.scrollBy(260, 1800);
        await t.pause(1600);
        await t.caption({
          chapter: "2 · A map of skills",
          title: "Ask a skill how common it is.",
          body: "Point at a skill, focus it, or tap it: it says how many published profiles list it and lights its neighbours.",
          personas: [partner("a quick read of what our builders actually work with")],
        });
        await t.moveTo("[data-hd-map-stage] [data-hd-skill='typescript']", 900);
        await t.pause(1800);
        await t.moveTo("[data-hd-map-stage] [data-hd-skill='react']", 800);
        await t.pause(1800);
        await t.moveTo("[data-hd-map-stage] [data-hd-skill='python']", 800);
        await t.pause(1600);
        await t.moveTo({ x: 300, y: 600 }, 500);
        await t.caption({
          chapter: "3 · Builders",
          title: "B’s card file, now connected.",
          body: "Cards stack into an index of names. Each carries a small skill signature; point at one and everyone who shares a skill lights up in the index. The map’s path runs on down the margin beside them.",
          why: ["Fictional local fixtures here; production shows real graduates."],
          personas: [partner("real work, and how builders relate to each other")],
        });
        await t.scrollTo("#builders", 2600, 0);
        for (let i = 0; i < 6; i += 1) {
          await t.scrollBy(320, 1300);
          await t.pause(400);
        }
        await t.moveTo("#builders .hd-bstack > li >> nth=6", 900);
        await t.pause(2200);
        await t.caption({
          chapter: "4 · Community",
          title: "Where each role plugs in.",
          body: "B’s tabs, with C’s shapes: a dot for builders, a ring for mentors, a diamond for partners. Each picture is built from real profile content.",
          why: ["Mentor and partner access is approved by the team, and each panel says so."],
          personas: [mentor("sees what a mentor actually does"), partner("sees the path to talent")],
        });
        await t.scrollTo("#community", 2600, 0);
        await t.pause(1500);
        await t.click("#hd-tab-mentor");
        await t.pause(2400);
        await t.press("ArrowRight");
        await t.pause(2400);
        await t.caption({
          chapter: "5 · Hire",
          title: "The path ties off at the next step.",
          body: "The thread that left the map ends in a knot above “Propose a project”, on the warm full-screen sheet. The cards part as you reach for them.",
          personas: [client("the whole page leads to one clear action")],
        });
        await t.scrollTo("#hire", 2800, 0);
        await t.pause(1600);
        await t.moveTo("[data-hd-hire-card] >> nth=0", 900);
        await t.pause(1300);
        await t.moveTo("[data-hd-hire-card] >> nth=1", 900);
        await t.pause(1300);
        await t.caption({
          chapter: "6 · Principles",
          title: "The outlined words, stacked like sheets.",
          body: "Unchanged from B: each principle rises as a card and fills peach as it lands.",
          why: ["One size for all five, measured from the font: never cropped.", "A browser test fails the build if any word is unreadable at any width."],
          personas: [student("EQUITY: no degree required"), juror("the closing beat")],
        });
        await t.scrollTo("#principles", 2600, 0);
        for (let i = 0; i < 7; i += 1) {
          await t.scrollBy(280, 1300);
          await t.pause(600);
        }
        await t.pause(800);
      },
    },
    {
      device: "phone",
      async run(t) {
        await t.caption({
          chapter: "On a phone",
          title: "The map becomes a path down the page.",
          body: "On a phone the radial map turns into a vertical trunk: stations light as you scroll and a small group walks into each step. Tap a skill to see how common it is.",
          personas: [student("a map she can read with one thumb")],
        });
        await t.reload();
        await t.pause(2600);
        await t.scrollTo("[data-hd-way]", 3200, 60);
        await t.pause(800);
        await t.scrollBy(500, 2400);
        await t.pause(700);
        await t.tap("[data-hd-band] [data-hd-skill]");
        await t.pause(1800);
        await t.scrollBy(500, 2400);
        await t.pause(700);
        await t.caption({
          chapter: "On a phone",
          title: "Everything else is B on a phone.",
          body: "The card file, tabs by touch, the warm hire sheet and the principles.",
          personas: [mentor("same clarity"), partner("same"), client("same")],
        });
        await t.scrollTo("#community", 3000, 0);
        await t.tap("#hd-tab-partner");
        await t.pause(1800);
        await t.scrollTo("#principles", 3000, 0);
        await t.scrollBy(700, 2600);
        await t.pause(800);
      },
    },
    {
      device: "laptop",
      async run(t) {
        await t.card({
          small: "Why candidate D",
          title: "Everything you liked in B, carried by one path.",
          body: "Wanjiku sees cohorts, that she qualifies, and learning as a path she walks with others. David sees where engineers join. Grace sees real skills and real builders. Tomás follows the thread to one next step. The skills map is a picture for now, ready to become the real thing if you build it. Every word passes the readability test at four widths, by keyboard and with reduced motion.",
        });
        await t.pause(8000);
      },
    },
  ],
};
