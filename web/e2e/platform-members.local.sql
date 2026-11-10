-- Fictional members for e2e/platform-members.spec.ts and the Members directory's screenshots, on top of
-- e2e/platform-personas.local.sql. Local D1 only: never apply to a deployed database.
-- npx wrangler d1 execute ttv-database --local --file e2e/platform-members.local.sql
-- Every name, handle, project and confirmation here is made up. Re-running it puts everything back.
INSERT OR REPLACE INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES
 ('ttv-local-member-kevin','Kevin Omondi','kevin@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-member-faith','Faith Njoki','faith@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-member-mercy','Mercy Wangari','mercy.w@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-member-daniel','Daniel Mutiso','daniel@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-member-grace','Grace Wanjiru','grace@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-member-samuel','Samuel Kiptoo','samuel@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-member-ruth','Ruth Chepkemoi','ruth@invalid.ttv',1,NULL,1793400000,1793400000);
-- Saved profiles: listed in the Members directory, not on the public website (none has completed a cohort).
-- Ruth's is held by the automatic check, so nobody but her and the admins sees it.
INSERT OR REPLACE INTO studentProfile (id,userId,handle,status,headline,bio,location,country,skills,openToFreelance,openToRoles,opportunityGoals,moderationOutcome) VALUES
 ('ttv-local-member-profile-kevin','ttv-local-member-kevin','kevin-omondi','DRAFT','Learning backend development in Kisumu',
  'I started with Python scripts for my family''s shop and now build small Django apps.','Kisumu','KE','["Python","Django","SQL"]',0,1,
  'An internship where I can ship real features with a team.',NULL),
 ('ttv-local-member-profile-faith','ttv-local-member-faith','faith-njoki','DRAFT','Designer moving into front-end',
  'Five years of print and brand design; now I build what I draw.','Nairobi','KE','["Figma","CSS","Accessibility","React"]',1,0,
  'Freelance front-end work for small studios and non-profits.',NULL),
 ('ttv-local-member-profile-mercy','ttv-local-member-mercy','mercy-wangari','DRAFT','Front-end developer working on payments and forms for small businesses in Nairobi',
  '','Nairobi','KE','["JavaScript","Vue","Accessibility","Node.js","Testing"]',1,1,
  'Booking and payments flows for clinics and salons.',NULL),
 ('ttv-local-member-profile-daniel','ttv-local-member-daniel','daniel-mutiso','DRAFT','Data analyst',
  'I turn county health data into dashboards people actually read.','Machakos','KE','["SQL","Python","Power BI"]',0,1,'',NULL),
 ('ttv-local-member-profile-grace','ttv-local-member-grace','grace-wanjiru','DRAFT','Mobile developer',
  '','Nakuru','KE','["Kotlin","Android","Firebase"]',1,1,'Contract work on Android apps for farmers'' cooperatives.',NULL),
 ('ttv-local-member-profile-samuel','ttv-local-member-samuel','samuel-kiptoo','DRAFT','',
  '','Eldoret','KE','[]',0,0,'',NULL),
 ('ttv-local-member-profile-ruth','ttv-local-member-ruth','ruth-chepkemoi','DRAFT','Waiting for a check',
  'Held by the automatic check in this fixture.','Kericho','KE','["Go"]',0,0,'','hold');
-- Saving a profile records the name it shows (publicName), as the editor does.
UPDATE studentProfile SET publicName=(SELECT name FROM user WHERE user.id=studentProfile.userId) WHERE id LIKE 'ttv-local-member-profile-%';
-- Posted work, a draft only its author sees, and a confirmation at the current revision.
DELETE FROM communityConfirmation WHERE journeyId LIKE 'ttv-local-member-work-%';
DELETE FROM communityJourney WHERE id LIKE 'ttv-local-member-work-%';
INSERT INTO communityJourney (id,userId,title,description,evidenceUrl,occurredAt,visibility,state,kind,version,createdAt,updatedAt) VALUES
 ('ttv-local-member-work-achieng-ledger','ttv-local-persona-alumna','Chama savings ledger',
  'Built the contribution ledger and the monthly reminder for our savings group of twelve.','https://example.com/chama-ledger','2026-06-14','institution','POSTED','contribution',1,1793400000,1793400000),
 ('ttv-local-member-work-kevin-stock','ttv-local-member-kevin','Shop stock counter',
  'A Django app that tells my family''s shop when maize flour is running low.','https://example.com/stock-counter','2026-09-02','institution','POSTED','contribution',1,1793400000,1793400000),
 ('ttv-local-member-work-faith-site','ttv-local-member-faith','Clinic booking page',
  'Designed and built an accessible booking page for a community clinic in Kibera.','https://example.com/clinic-booking','2026-08-20','institution','POSTED','contribution',1,1793400000,1793400000),
 ('ttv-local-member-work-faith-draft','ttv-local-member-faith','Unfinished portfolio',
  'A draft only Faith can see.',NULL,'2026-10-01','private','DRAFT','contribution',1,1793400000,1793400000),
 ('ttv-local-member-work-daniel-dash','ttv-local-member-daniel','Clinic visits dashboard',
  'Weekly clinic visits by sub-county, from the county''s open data.','https://example.com/clinic-dashboard','2026-07-11','institution','POSTED','contribution',1,1793400000,1793400000);
INSERT INTO communityJourney (id,userId,title,description,evidenceUrl,occurredAt,visibility,state,kind,repoFullName,repoUrl,repoDescription,language,topics,stars,pushedAt,snapshotAt,sortOrder,version,createdAt,updatedAt) VALUES
 ('ttv-local-member-work-achieng-repo','ttv-local-persona-alumna','mpesa-callbacks',
  'Handles payment callbacks that arrive twice.','https://github.com/achieng-otieno/mpesa-callbacks','2026-09-01','institution','POSTED','repo',
  'achieng-otieno/mpesa-callbacks','https://github.com/achieng-otieno/mpesa-callbacks','Idempotent payment callback handling','TypeScript','["payments","idempotency"]',12,1793318400,1793404800,0,1,1793400000,1793400000);
INSERT INTO communityConfirmation (id,journeyId,mentorId,statement,method,journeyVersion,mentorRole,createdAt) VALUES
 ('ttv-local-member-work-confirm-achieng','ttv-local-member-work-achieng-ledger','ttv-local-persona-mentor',
  'Walked through the ledger with Achieng; the reconciliation logic is hers.','Reviewed the code and asked about the design',1,'MENTOR',1793400000),
 ('ttv-local-member-work-confirm-faith','ttv-local-member-work-faith-site','ttv-local-persona-mentor',
  'Checked the page with a screen reader and keyboard; Faith fixed what we found.','Tested it together on a call',1,'MENTOR',1793400000);
-- e2e/platform-profile-editor.spec.ts: a graduate of her own for taking herself off the public website and
-- back, so no other spec sees the listing change under it. Re-seeding lists her again, with one post.
INSERT OR REPLACE INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES
 ('ttv-local-persona-graduate','Zawadi Mwende','zawadi@invalid.ttv',1,NULL,1793400000,1793400000);
INSERT OR REPLACE INTO session (id,expiresAt,token,ipAddress,userAgent,userId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-graduate-session',1893456000,'ttv-local-persona-graduate-token',NULL,'local','ttv-local-persona-graduate',1793400000,1793400000);
INSERT OR REPLACE INTO programApplication (id,programId,userId,status,application,completedAt,createdAt,updatedAt) VALUES
 ('ttv-local-persona-app-graduate','ttv-local-persona-cohort-04','ttv-local-persona-graduate','COMPLETED','{}',1780272000,1770000000,1780272000);
INSERT OR REPLACE INTO studentProfile (id,userId,handle,status,headline,bio,location,country,skills,publicName,publishedAt) VALUES
 ('ttv-local-persona-profile-graduate','ttv-local-persona-graduate','zawadi-mwende','PUBLISHED','Mobile developer',
  'I build Android apps for boda boda riders.','Machakos','KE','["Kotlin","Android"]','Zawadi Mwende',1781000000);
INSERT OR REPLACE INTO blogPost (id,profileId,slug,title,contentMarkdown,status,publishedAt) VALUES
 ('ttv-local-persona-post-graduate','ttv-local-persona-profile-graduate','offline-first-fares','Offline-first fares',
  'Riders lose signal between stages, so the app keeps every fare on the phone until it can send it.','PUBLISHED',1781100000);
-- e2e/platform-profile-editor.spec.ts: a member of her own for changing her handle, so no other spec
-- (the admin-access one gives Brian a role) changes who she is under it. Re-seeding puts her handle back.
INSERT OR REPLACE INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES
 ('ttv-local-persona-renamer','Neema Atieno','neema@invalid.ttv',1,NULL,1793400000,1793400000);
INSERT OR REPLACE INTO session (id,expiresAt,token,ipAddress,userAgent,userId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-renamer-session',1893456000,'ttv-local-persona-renamer-token',NULL,'local','ttv-local-persona-renamer',1793400000,1793400000);
INSERT OR REPLACE INTO studentProfile (id,userId,handle,status,headline,skills,publicName) VALUES
 ('ttv-local-persona-profile-renamer','ttv-local-persona-renamer','neema-atieno','DRAFT','Data journalist','["Python","SQL"]','Neema Atieno');
