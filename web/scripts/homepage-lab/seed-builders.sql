-- Local-only fixture for designing the homepage builder showcase.
--
-- Every person here is FICTIONAL. Handles start with "fixture-" and emails use
-- the reserved example.invalid domain so nothing can be mistaken for a real
-- student. Apply with:
--   npx wrangler d1 execute ttv-database --local --file scripts/homepage-lab/seed-builders.sql
-- Safe to re-run: it deletes its own rows first.

DELETE FROM user WHERE email LIKE '%@fixture.example.invalid';
DELETE FROM program WHERE id LIKE 'fixture-program-%';
DELETE FROM curriculum WHERE id = 'fixture-curriculum';

INSERT INTO curriculum (id, title, description) VALUES
  ('fixture-curriculum', 'Full-stack foundations (fixture)', 'Fictional curriculum for local design work.');

INSERT INTO program (id, name, description, curriculumId, startDate, endDate) VALUES
  ('fixture-program-01', 'Cohort 01', 'Fictional fixture cohort.', 'fixture-curriculum', 1704067200, 1711929600),
  ('fixture-program-02', 'Cohort 02', 'Fictional fixture cohort.', 'fixture-curriculum', 1717200000, 1725148800),
  ('fixture-program-03', 'Cohort 03', 'Fictional fixture cohort.', 'fixture-curriculum', 1730419200, 1738368000);

INSERT INTO user (id, name, email, emailVerified) VALUES
  ('fixture-user-1', 'Wanjiru Kamau', 'wanjiru@fixture.example.invalid', 1),
  ('fixture-user-2', 'Brian Otieno', 'brian@fixture.example.invalid', 1),
  ('fixture-user-3', 'Achieng Atieno', 'achieng@fixture.example.invalid', 1),
  ('fixture-user-4', 'Kiprop Cheruiyot', 'kiprop@fixture.example.invalid', 1),
  ('fixture-user-5', 'Nyambura Mwangi', 'nyambura@fixture.example.invalid', 1),
  ('fixture-user-6', 'Mutua Musyoka', 'mutua@fixture.example.invalid', 1),
  ('fixture-user-7', 'Akinyi Ochieng', 'akinyi@fixture.example.invalid', 1),
  ('fixture-user-8', 'Baraka Njoroge', 'baraka@fixture.example.invalid', 1);

INSERT INTO programApplication (id, programId, userId, status, application, completedAt) VALUES
  ('fixture-app-1', 'fixture-program-01', 'fixture-user-1', 'COMPLETED', '{}', 1711929600),
  ('fixture-app-2', 'fixture-program-01', 'fixture-user-2', 'COMPLETED', '{}', 1711929600),
  ('fixture-app-3', 'fixture-program-02', 'fixture-user-3', 'COMPLETED', '{}', 1725148800),
  ('fixture-app-4', 'fixture-program-02', 'fixture-user-4', 'COMPLETED', '{}', 1725148800),
  ('fixture-app-5', 'fixture-program-02', 'fixture-user-5', 'COMPLETED', '{}', 1725148800),
  ('fixture-app-6', 'fixture-program-03', 'fixture-user-6', 'COMPLETED', '{}', 1738368000),
  ('fixture-app-7', 'fixture-program-03', 'fixture-user-7', 'COMPLETED', '{}', 1738368000),
  ('fixture-app-8', 'fixture-program-03', 'fixture-user-8', 'COMPLETED', '{}', 1738368000);

INSERT INTO studentProfile (id, userId, handle, status, headline, country, skills, openToFreelance, openToRoles, publishedAt, publicName) VALUES
  ('fixture-profile-1', 'fixture-user-1', 'fixture-wanjiru', 'PUBLISHED', 'Backend developer building payment reconciliation tools', 'Kenya', '["TypeScript","PostgreSQL","Node.js"]', 1, 1, 1738454400, 'Wanjiru Kamau'),
  ('fixture-profile-2', 'fixture-user-2', 'fixture-brian', 'PUBLISHED', 'Mobile developer shipping offline-first Android apps', 'Kenya', '["Kotlin","Android","SQLite"]', 1, 0, 1738368000, 'Brian Otieno'),
  ('fixture-profile-3', 'fixture-user-3', 'fixture-achieng', 'PUBLISHED', 'Frontend engineer who cares about accessible forms', 'Kenya', '["React","Accessibility","CSS"]', 0, 1, 1738281600, 'Achieng Atieno'),
  ('fixture-profile-4', 'fixture-user-4', 'fixture-kiprop', 'PUBLISHED', 'Data tinkerer mapping rainfall against harvest records', 'Kenya', '["Python","Pandas","Data viz"]', 1, 1, 1738195200, 'Kiprop Cheruiyot'),
  ('fixture-profile-5', 'fixture-user-5', 'fixture-nyambura', 'PUBLISHED', 'Full-stack builder turning spreadsheets into small apps', 'Kenya', '["Astro","SQLite","Tailwind"]', 1, 0, 1738108800, 'Nyambura Mwangi'),
  ('fixture-profile-6', 'fixture-user-6', 'fixture-mutua', 'PUBLISHED', 'DevOps-curious developer automating school timetables', 'Kenya', '["Go","Docker","GitHub Actions"]', 0, 1, 1738022400, 'Mutua Musyoka'),
  ('fixture-profile-7', 'fixture-user-7', 'fixture-akinyi', 'PUBLISHED', 'Product-minded developer building a clinic queue SMS tool', 'Kenya', '["Twilio","Node.js","UX research"]', 1, 1, 1737936000, 'Akinyi Ochieng'),
  ('fixture-profile-8', 'fixture-user-8', 'fixture-baraka', 'PUBLISHED', 'Junior developer learning in public with weekly write-ups', 'Kenya', '["JavaScript","Git","Writing"]', 0, 1, 1737849600, 'Baraka Njoroge');

INSERT INTO profileHighlight (id, profileId, repoFullName, repoUrl, description, language, stars, sortOrder, snapshotAt, blurb) VALUES
  ('fixture-hl-1', 'fixture-profile-1', 'fixture/chama-ledger', 'https://example.invalid/chama-ledger', 'Shared savings ledger for a chama, with M-Pesa statement import.', 'TypeScript', 14, 0, 1738454400, 'Wrote the statement parser and its tests.'),
  ('fixture-hl-2', 'fixture-profile-2', 'fixture/matatu-routes', 'https://example.invalid/matatu-routes', 'Offline route finder for Nairobi matatus.', 'Kotlin', 9, 0, 1738368000, 'Built the offline sync layer.'),
  ('fixture-hl-3', 'fixture-profile-3', 'fixture/form-kit', 'https://example.invalid/form-kit', 'Accessible form components tested with screen readers.', 'TypeScript', 21, 0, 1738281600, 'Designed the error-message pattern.'),
  ('fixture-hl-4', 'fixture-profile-4', 'fixture/mvua-data', 'https://example.invalid/mvua-data', 'Rainfall and harvest notebooks for three counties.', 'Python', 6, 0, 1738195200, 'Cleaned ten years of station data.'),
  ('fixture-hl-5', 'fixture-profile-5', 'fixture/duka-stock', 'https://example.invalid/duka-stock', 'Stock tracker for a neighbourhood shop.', 'Astro', 4, 0, 1738108800, 'Shipped it to a real shop counter.'),
  ('fixture-hl-6', 'fixture-profile-6', 'fixture/ratiba', 'https://example.invalid/ratiba', 'Timetable generator for secondary schools.', 'Go', 11, 0, 1738022400, 'Wrote the constraint solver.'),
  ('fixture-hl-7', 'fixture-profile-7', 'fixture/foleni', 'https://example.invalid/foleni', 'SMS queue tickets for a busy clinic.', 'JavaScript', 8, 0, 1737936000, 'Ran the patient interviews.'),
  ('fixture-hl-8', 'fixture-profile-8', 'fixture/learning-log', 'https://example.invalid/learning-log', 'Weekly notes on what I learned and broke.', 'JavaScript', 3, 0, 1737849600, '52 weeks of posts, no gaps.');
