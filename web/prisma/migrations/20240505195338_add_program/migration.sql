-- Insert into Curriculum
INSERT INTO "Curriculum" ("id", "title", "description", "createdAt", "updatedAt") 
VALUES 
  ('vs76c35jarwt8j81zl390xvr', 'Full-stack Web Development', 'The TTV web curriculum teaches students how to get a full fledged web application up and running from design to deployment.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Insert into Program
INSERT INTO "Program" ("id", "name", "description", "curriculumId", "createdAt", "updatedAt") 
VALUES 
  ('p7xwmljq6tf9jctf62nrp9wz', '2023 Cohort 1', '2023 Cohort 1', 'vs76c35jarwt8j81zl390xvr', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);