// Narrated walkthrough of homepage candidate C. Record with:
//   node scripts/homepage-lab/record.mjs scripts/homepage-lab/tours/c.mjs ../.homepage-lab/videos/candidate-c-constellation.mp4
const student = (text) => ({ id: "student", text });
const mentor = (text) => ({ id: "mentor", text });
const partner = (text) => ({ id: "partner", text });
const client = (text) => ({ id: "client", text });
const juror = (text) => ({ id: "juror", text });

export default {
  path: "/preview/home/c",
  label: "Candidate C · Constellation",
  segments: [
    {
      device: "laptop",
      async run(t) {
        await t.card({
          small: "Homepage candidate C",
          title: "Constellation: the community as a living network.",
          body: "Cohorts sit at the centre. Builders, mentors and partners are nodes, and the page shows that one network from a new angle in every section. Three build rounds, two persona critiques and a release check.",
        });
        await t.pause(4200);
        await t.reload();
        await t.hideCard();
        await t.caption({
          chapter: "1 · Cohorts first",
          title: "The cohort is the headline.",
          body: "The first thing anyone reads is what we do: cohorts where builders learn by shipping real software.",
          why: [
            "The text paints in pure CSS before any script loads, so it reads instantly on slow mobile data.",
            "“No degree required.” sits right under Apply.",
          ],
          personas: [student("knows what a cohort is, that she qualifies and where to apply, in one screen")],
        });
        await t.pause(3800);
        await t.caption({
          chapter: "1 · Cohorts first",
          title: "A network that notices you.",
          body: "Four cohort clusters around a centre; 04 pulses because it is running now. Move the pointer and nearby nodes lean in.",
          why: ["One visual language for the whole page: peach dots are builders, teal rings mentors, diamonds partners."],
          personas: [juror("authored, alive, and never behind the text")],
        });
        for (const [x, y] of [[1000, 260], [1120, 330], [1060, 450], [930, 380], [1180, 520], [1020, 300]]) await t.moveTo({ x, y }, 650);
        await t.pause(800);
        await t.moveTo({ x: 720, y: 600 }, 500);
        await t.caption({
          chapter: "2 · How a cohort works",
          title: "A camera inside Cohort 04.",
          body: "As you read the three steps, the diagram changes with you: builders connect, mentors join, then the ring opens into the wider community.",
          why: ["Mentors appear as part of how a cohort works, not as decoration."],
          personas: [mentor("sees exactly where engineers fit in"), student("sees she won't learn alone")],
        });
        await t.scrollTo(".hc-rhythm", 2200, 80);
        await t.pause(1200);
        await t.scrollBy(520, 2600);
        await t.pause(1400);
        await t.scrollBy(520, 2600);
        await t.pause(1400);
        await t.scrollBy(420, 2200);
        await t.pause(1200);
        await t.caption({
          chapter: "3 · Builders",
          title: "Real people, connected by real skills.",
          body: "Every published graduate, with what they built and the skills they used. Hover a card and threads run through the gutters to everyone who shares a skill.",
          why: ["Profiles come straight from the database: these are fictional local fixtures, production shows real graduates.", "Threads never cross text; unrelated cards step back."],
          personas: [partner("is looking at evidence of work, not a template")],
        });
        await t.scrollTo("#builders", 2200, 80);
        await t.pause(1200);
        await t.moveTo(".hc-card", 900);
        await t.pause(2200);
        await t.moveTo(".hc-card >> nth=2", 900);
        await t.pause(2200);
        await t.moveTo(".hc-card >> nth=6", 900);
        await t.pause(2000);
        await t.caption({
          chapter: "3 · Builders",
          title: "Pin a skill.",
          body: "Skill chips are buttons. Pin one and every builder with that skill lights up — by mouse, touch or keyboard.",
          personas: [partner("can scan for a skill in one tap"), juror("a small, useful delight")],
        });
        await t.click(".hc-card >> nth=0 >> .hc-chip >> nth=0");
        await t.pause(2600);
        await t.press("Escape");
        await t.pause(600);
        await t.caption({
          chapter: "4 · Community",
          title: "Not in a cohort? Join anyway.",
          body: "Three ways in, each with a clear action: builder, mentor, institutional partner. Hover a role and the network shows where it plugs in.",
          why: ["Every card says plainly that mentor and partner access is approved by the team."],
          personas: [mentor("one click to “Join as a mentor”"), partner("a direct path to talent")],
        });
        await t.scrollTo("#community", 2400, 80);
        await t.pause(1500);
        await t.moveTo('.hc-role[data-role="builder"]', 900);
        await t.pause(1800);
        await t.moveTo('.hc-role[data-role="mentor"]', 900);
        await t.pause(1800);
        await t.moveTo('.hc-role[data-role="partner"]', 900);
        await t.pause(1800);
        await t.caption({
          chapter: "5 · Hire",
          title: "Every thread leads to one next step.",
          body: "The network converges on a single warm panel: hire our builders or propose a project. The button leans toward your pointer.",
          personas: [client("knows what to do and what happens after: an introduction, then contracts directly")],
        });
        await t.scrollTo("#hire", 2600, 160);
        await t.pause(1400);
        await t.moveTo("#hire [data-hc-magnetic]", 1100);
        await t.pause(700);
        await t.moveTo({ x: 520, y: 520 }, 500);
        await t.moveTo("#hire [data-hc-magnetic]", 600);
        await t.pause(1400);
        await t.caption({
          chapter: "6 · Principles",
          title: "The outlined words, never cropped.",
          body: "The five principles close the page at full width. Each outline wipes in whole, and the word you are reading fills with peach.",
          why: ["One shared size set by the longest word, measured from the font, so nothing is ever cut off.", "A browser test fails the build if any word is unreadable at any width."],
          personas: [student("EQUITY: no degree required, English yes, fluency no"), juror("a closing crescendo")],
        });
        await t.scrollTo("#principles", 2600, 80);
        await t.pause(1000);
        for (let i = 0; i < 6; i += 1) {
          await t.scrollBy(260, 1500);
          await t.pause(900);
        }
        await t.pause(1200);
      },
    },
    {
      device: "phone",
      async run(t) {
        await t.caption({
          chapter: "On a phone",
          title: "Built for a mid-range Android on metered data.",
          body: "First screen: what a cohort is, Apply, and “No degree required.” No images, no video; the text never waits for script.",
          personas: [student("understands it in five seconds, one thumb")],
        });
        await t.reload();
        await t.pause(3200);
        await t.scrollTo("#builders", 2600, 70);
        await t.pause(800);
        await t.caption({
          chapter: "On a phone",
          title: "Builders become a swipeable rail.",
          body: "The next card peeks in so it's obvious there's more. Tap a skill and the rail glides to the next builder who has it.",
          personas: [partner("browses talent by touch"), juror("short page: 6,700 px instead of 8,800")],
        });
        await t.scrollBy(360, 1400);
        await t.pause(600);
        await t.swipe(".hc-builders__grid", 300, 900);
        await t.swipe(".hc-builders__grid", 300, 900);
        await t.tap(".hc-builders__grid .hc-chip");
        await t.pause(1800);
        await t.caption({
          chapter: "On a phone",
          title: "Role pills drive the diagram.",
          body: "In the community band, the legend is the control: tap Mentor or Partner and the camera moves to where that role plugs in.",
          personas: [mentor("sees his place without hovering"), partner("same")],
        });
        await t.scrollTo("#community", 2400, 70);
        await t.pause(900);
        await t.tap('.hc-legend__pill[data-role="mentor"]');
        await t.pause(1700);
        await t.tap('.hc-legend__pill[data-role="partner"]');
        await t.pause(1700);
        await t.scrollTo("#principles", 3000, 70);
        await t.scrollBy(900, 3200);
        await t.pause(1000);
      },
    },
    {
      device: "laptop",
      async run(t) {
        await t.card({
          small: "Why candidate C",
          title: "One idea, carried all the way down.",
          body: "Wanjiku sees cohorts and that she qualifies. David sees where mentors fit. Grace sees real work, connected by real skills. Tomás gets one clear next step. Every word passes the readability test at 390, 820, 1440 and 1920 px, by keyboard and with reduced motion.",
        });
        await t.pause(7000);
      },
    },
  ],
};
