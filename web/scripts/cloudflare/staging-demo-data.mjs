import { assertVerifiedStagingFixtureTarget } from "./staging-fixture-target.mjs";

export const DEMO_NAMESPACE = "ttv-staging-demo-v1";
export const DEMO_PERSONAS = Object.freeze({
  mentor: `${DEMO_NAMESPACE}-mentor`, institution: `${DEMO_NAMESPACE}-institution`,
  cohort: `${DEMO_NAMESPACE}-member-cohort`, noncohort: `${DEMO_NAMESPACE}-member-noncohort`,
});
export const DEMO_SEARCH_EXAMPLES = Object.freeze([
  { query: "TypeScript", skills: ["React"], context: "Inspect a documented accessible interface contribution; distinguish self-report and synthetic mentor context." },
  { query: "Python", skills: ["SQL"], context: "Explore data-cleaning work and ask about reproducibility and missing evidence." },
  { query: "Accessibility", skills: [], context: "Compare keyboard-navigation evidence without ranking people or inferring ability." },
  { query: "Kotlin", skills: [], context: "Explore a fictional Android project and its documented limitations." },
]);
const epoch = 1792886400;
const firstNames = ["Amina", "Brian", "Grace", "David", "Faith", "Peter", "Wanjiru", "Otieno", "Njeri", "Kamau", "Wambui", "Achieng", "Kiptoo", "Chebet", "Mwangi"];
const lastNames = ["Wanjiku", "Otieno", "Njeri", "Mwangi", "Achieng", "Kamau", "Kiplagat", "Wambui", "Mutua", "Chebet"];
const tracks = [
  ["Accessible library interface", ["TypeScript", "React", "Accessibility"], "keyboard navigation and visible focus states", "frontend collaboration"],
  ["Community data notebook", ["Python", "SQL", "Data analysis"], "data cleaning and reproducible checks", "data analysis opportunities"],
  ["Android study planner", ["Kotlin", "Android", "Testing"], "offline task storage and input validation", "mobile development"],
  ["Fictional inventory API", ["TypeScript", "Node.js", "SQL"], "API validation and query tests", "backend development"],
  ["Neighbourhood map prototype", ["Python", "GIS", "Data visualization"], "map filtering and source attribution", "geospatial collaboration"],
  ["Design-system exploration", ["Figma", "UX research", "Accessibility"], "component states and keyboard-flow documentation", "product design practice"],
  ["Deployment practice project", ["Linux", "CI/CD", "Docker"], "repeatable builds and deployment checks", "platform engineering practice"],
  ["Learning-resource catalogue", ["Java", "SQL", "Testing"], "catalogue search and unit tests", "software development"],
  ["Interface test workshop", ["Playwright", "TypeScript", "Testing"], "browser tests and failure diagnostics", "quality engineering"],
  ["Small service experiment", ["Go", "HTTP", "Testing"], "request limits and error handling", "backend collaboration"],
];
const timestamps = { createdAt: epoch, updatedAt: epoch };

/** Fixed synthetic corpus; no random identities, private records, scores or inference. */
export function buildDemoDataset() {
  const records = { curriculum: [], program: [], user: [], communityProfile: [], programApplication: [], communityJourney: [], communityConfirmation: [] };
  records.curriculum.push({ id: `${DEMO_NAMESPACE}-curriculum`, title: "Fictional demo curriculum", description: "Synthetic staging material; no real cohort or teaching claim.", ...timestamps });
  records.program.push({ id: `${DEMO_NAMESPACE}-program`, name: "Fictional community demo cohort", description: "Synthetic staging cohort; no real enrolment or recordings.", curriculumId: `${DEMO_NAMESPACE}-curriculum`, applicationsOpen: 0, ...timestamps });
  const personas = Object.values(DEMO_PERSONAS);
  for (let i = 0; i < 150; i++) {
    const id = i < 4 ? personas[i] : `${DEMO_NAMESPACE}-member-${String(i - 3).padStart(3, "0")}`;
    const name = `Fictional ${firstNames[i % firstNames.length]} ${lastNames[Math.floor(i / firstNames.length)]}`;
    const [project, skills, contribution, goal] = tracks[(i + 9) % tracks.length];
    const cohort = i === 2 || (i >= 4 && i % 2 === 0);
    records.user.push({ id, name, email: `${id}@invalid.ttv`, emailVerified: 1, ...timestamps });
    records.communityProfile.push({ userId: id, headline: i === 0 ? "Fictional mentor · scoped contribution review" : `Fictional builder · ${skills[0]}`, bio: `Synthetic Kenyan demonstration profile. ${i === 0 ? "Mentor statements describe fictional review activity only." : `Exploring ${project.toLowerCase()}; ${i % 3 === 0 ? "documentation is still incomplete" : "claims are self-reported and supporting links are placeholders"}.`} This is not a real person or a verified ability claim.`, skills: JSON.stringify(i === 0 ? ["Mentoring", "Testing"] : skills), opportunityGoals: i === 0 ? "Fictional contribution review" : `Explore ${goal}; fictional example, no placement promise.`, version: 1, ...timestamps });
    if (cohort) records.programApplication.push({ id: `${id}-application`, programId: `${DEMO_NAMESPACE}-program`, userId: id, status: "APPROVED", application: JSON.stringify({ synthetic: true, namespace: DEMO_NAMESPACE, note: "Fictional demo membership only" }), ...timestamps });
    const entryCount = i === 0 || i % 11 === 0 ? 0 : 1 + i % 3;
    for (let j = 0; j < entryCount; j++) {
      const journeyId = `${id}-journey-${j + 1}`;
      records.communityJourney.push({ id: journeyId, userId: id, title: `Fictional ${project}${j > 0 ? ` · iteration ${j + 1}` : ""}`, description: `Synthetic example: I worked on ${contribution}${j > 0 ? " and documented a follow-up change" : ""}. ${i % 4 === 0 ? "Testing notes are incomplete; do not infer production experience." : "This is a self-reported demonstration, not externally verified work."}`, evidenceUrl: i % 5 === 0 && j === 0 ? null : `https://example.com/ttv-fictional-demo/${i}/${j + 1}`, occurredAt: `2026-10-${String(19 + j).padStart(2, "0")}`, visibility: j === 2 && i % 2 === 0 ? "private" : "institution", version: 1, ...timestamps });
      if ((i + j) % 3 === 0) records.communityConfirmation.push({ id: `${journeyId}-confirmation`, journeyId, mentorId: DEMO_PERSONAS.mentor, statement: "Synthetic mentor statement: in this fictional example, I reviewed the described change and its stated limits. No real review or endorsement occurred.", method: "Fictional walkthrough of demonstration notes; placeholder source not independently inspected.", journeyVersion: 1, mentorRole: "MENTOR", ...timestamps });
    }
  }
  return records;
}
const rows = result => (Array.isArray(result) ? result : [result]).flatMap(item => item?.results ?? []);
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));
const placeholders = values => values.map(() => "?").join(",");
const descriptors = {
  curriculum: ["id", ["title"]], program: ["id", ["curriculumId"]], user: ["id", ["email"]],
  communityProfile: ["userId", []], programApplication: ["id", ["userId", "programId"]],
  communityJourney: ["id", ["userId"]], communityConfirmation: ["id", ["journeyId", "mentorId"]], UserRoles: ["id", ["userId", "roleId"]],
};

/** Persistent seed only. A verified fixed-staging executor is required; never mint auth. */
export async function seedDemoData(target, audit = () => {}) {
  assertVerifiedStagingFixtureTarget(target);
  const records = buildDemoDataset();
  const execute = target.executeQuery;
  try {
    const roles = rows(await execute('SELECT id,name FROM "Roles" WHERE name IN (?,?,?)', ["MENTOR", "INSTITUTION", "STUDENT"]));
    if (roles.length !== 3 || new Set(roles.map(role => role.name)).size !== 3) throw new Error();
    const roleId = name => roles.find(role => role.name === name).id;
    records.UserRoles = records.user.flatMap(user => {
      const role = user.id === DEMO_PERSONAS.mentor ? "MENTOR" : user.id === DEMO_PERSONAS.institution ? "INSTITUTION" : records.programApplication.some(application => application.userId === user.id) ? "STUDENT" : null;
      return role ? [{ id: `${user.id}-role`, userId: user.id, roleId: roleId(role), ...timestamps }] : [];
    });
    // Check every fixed primary key and parent before ANY mutation.
    for (const [table, list] of Object.entries(records)) {
      const [key, owners] = descriptors[table];
      const expected = new Map(list.map(record => [record[key], record]));
      for (const batch of chunks([...expected.keys()], 40)) {
        const existing = rows(await execute(`SELECT "${key}"${owners.map(column => `,"${column}"`).join("")} FROM "${table}" WHERE "${key}" IN (${placeholders(batch)})`, batch));
        for (const found of existing) if (!expected.has(found[key]) || owners.some(column => found[column] !== expected.get(found[key])[column])) throw new Error();
      }
    }
    for (const batch of chunks(records.user, 40)) {
      const existing = rows(await execute(`SELECT id,email FROM "user" WHERE email IN (${placeholders(batch)})`, batch.map(user => user.email)));
      if (existing.some(user => user.email !== `${user.id}@invalid.ttv` || !batch.some(expected => expected.id === user.id))) throw new Error();
      const assigned = rows(await execute(`SELECT ur.userId,r.name FROM "UserRoles" ur JOIN "Roles" r ON r.id=ur.roleId WHERE ur.userId IN (${placeholders(batch)})`, batch.map(user => user.id)));
      if (assigned.some(assignment => !records.UserRoles.some(role => role.userId === assignment.userId && role.roleId === roleId(assignment.name)))) throw new Error();
    }
    for (const [table, list] of Object.entries(records)) {
      if (list.length === 0) continue;
      const columns = Object.keys(list[0]);
      for (const batch of chunks(list, Math.floor(90 / columns.length))) {
        await execute(`INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(",")}) VALUES ${batch.map(() => `(${placeholders(columns)})`).join(",")} ON CONFLICT DO NOTHING`, batch.flatMap(record => columns.map(column => record[column])));
      }
    }
    for (const [table, list] of Object.entries(records)) {
      const [key] = descriptors[table];
      for (const batch of chunks(list.map(record => record[key]), 40)) {
        const found = rows(await execute(`SELECT COUNT(*) AS remaining FROM "${table}" WHERE "${key}" IN (${placeholders(batch)})`, batch));
        if (found.length !== 1 || found[0].remaining !== batch.length) throw new Error();
      }
    }
    const receipt = { synthetic: true, namespace: DEMO_NAMESPACE, profiles: 150, selectorPersonas: 4, numberedMembers: 146, eligibleTalent: 149, cohortMembers: records.programApplication.length, journeys: records.communityJourney.length, confirmations: records.communityConfirmation.length, retained: true, modelCalls: 0 };
    audit({ event: "retained-demo-seed", status: "passed", ...receipt });
    return receipt;
  } catch {
    audit({ event: "retained-demo-seed", status: "failed", namespace: DEMO_NAMESPACE });
    throw new Error("Retained demo seed incomplete; inspect owned-record guards before retrying.");
  }
}
