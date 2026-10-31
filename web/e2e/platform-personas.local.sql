-- Fictional local personas for e2e/platform-personas.spec.ts. Local D1 only: never apply to a deployed database.
-- npx wrangler d1 execute ttv-database --local --file e2e/platform-personas.local.sql
INSERT OR REPLACE INTO curriculum (id,title,description) VALUES ('ttv-local-persona-curriculum','Full-stack foundations','Fictional local curriculum');
INSERT OR REPLACE INTO program (id,name,description,curriculumId,startDate,endDate,applicationsOpen) VALUES
 ('ttv-local-persona-cohort-04','Cohort 04','Fictional completed cohort','ttv-local-persona-curriculum',1772323200,1780272000,0),
 ('ttv-local-persona-cohort-05','Cohort 05','Fictional current cohort','ttv-local-persona-curriculum',1788220800,1797292800,0),
 ('ttv-local-persona-cohort-06','Cohort 06','Fictional next cohort','ttv-local-persona-curriculum',1799971200,1807833600,1);
INSERT OR REPLACE INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES
 ('ttv-local-persona-student','Wanjiku Mwangi','wanjiku@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-alumna','Achieng Otieno','achieng@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-mentor','David Kamau','david@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-community','Lucy Chebet','lucy@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-institution','Joseph Mutua','joseph@invalid.ttv',1,NULL,1793400000,1793400000),
 ('ttv-local-persona-staff','Amina Hassan','amina@invalid.ttv',1,NULL,1793400000,1793400000);
INSERT OR REPLACE INTO session (id,expiresAt,token,ipAddress,userAgent,userId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-student-session',1893456000,'ttv-local-persona-student-token',NULL,'local','ttv-local-persona-student',1793400000,1793400000),
 ('ttv-local-persona-alumna-session',1893456000,'ttv-local-persona-alumna-token',NULL,'local','ttv-local-persona-alumna',1793400000,1793400000),
 ('ttv-local-persona-mentor-session',1893456000,'ttv-local-persona-mentor-token',NULL,'local','ttv-local-persona-mentor',1793400000,1793400000),
 ('ttv-local-persona-community-session',1893456000,'ttv-local-persona-community-token',NULL,'local','ttv-local-persona-community',1793400000,1793400000),
 ('ttv-local-persona-institution-session',1893456000,'ttv-local-persona-institution-token',NULL,'local','ttv-local-persona-institution',1793400000,1793400000),
 ('ttv-local-persona-staff-session',1893456000,'ttv-local-persona-staff-token',NULL,'local','ttv-local-persona-staff',1793400000,1793400000);
INSERT OR REPLACE INTO UserRoles (id,userId,roleId,createdAt,updatedAt) VALUES
 ('ttv-local-persona-role-david','ttv-local-persona-mentor',(SELECT id FROM Roles WHERE name='MENTOR'),1793400000,1793400000),
 ('ttv-local-persona-role-joseph','ttv-local-persona-institution',(SELECT id FROM Roles WHERE name='INSTITUTION'),1793400000,1793400000),
 ('ttv-local-persona-role-amina','ttv-local-persona-staff',(SELECT id FROM Roles WHERE name='ADMIN'),1793400000,1793400000);
INSERT OR REPLACE INTO programApplication (id,programId,userId,status,application,completedAt,createdAt,updatedAt) VALUES
 ('ttv-local-persona-app-student','ttv-local-persona-cohort-05','ttv-local-persona-student','APPROVED','{}',NULL,1785000000,1786000000),
 ('ttv-local-persona-app-alumna','ttv-local-persona-cohort-04','ttv-local-persona-alumna','COMPLETED','{}',1780272000,1770000000,1780272000);
INSERT OR REPLACE INTO studentProfile (id,userId,handle,status,headline,bio,location,country,skills,publishedAt) VALUES
 ('ttv-local-persona-profile-alumna','ttv-local-persona-alumna','achieng-otieno','PUBLISHED','Backend builder','I build payment and ledger tools for small groups.','Kisumu','KE','["TypeScript","SQL"]',1781000000);
