-- on the next line delete ProgramApplication where id = clvam1z1m0001l8nqv52vejc6
delete from "ProgramApplication"
where id = 'clvamhxke0009l8nqi6x5ii0j';

-- update all program applications so program id = p7xwmljq6tf9jctf62nrp9wz
update "ProgramApplication"
set "programId" = 'p7xwmljq6tf9jctf62nrp9wz';

-- insert a new program 
-- Insert into Program
INSERT INTO "Program" ("id", "name", "description", "curriculumId", "createdAt", "updatedAt") 
VALUES 
  ('wckweg3i8l4ea952a42pkp2c', '2024 Cohort 1', '2024 Cohort 1', 'vs76c35jarwt8j81zl390xvr', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);