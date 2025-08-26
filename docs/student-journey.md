# Student Journey

This document outlines a proposed "Student Journey" feature for tracking learning activities completed on or off the platform. The goal is to provide a timeline of courses a student has completed, along with supporting evidence and a verification workflow.

## Existing Structure

The application currently models users, programs, applications, and roles using Prisma. Relevant examples include:

- `User` records represent platform users and are linked to roles and program applications.
- `Program` and `ProgramApplication` handle enrollment in learning programs. A `Program` effectively acts as an internal course and `ProgramApplication.status` tracks a student's progress.
- `Role` and `UserRole` allow assigning roles such as mentors or administrators.

These models provide the foundation for associating journey entries with a user and restricting verification actions to specific roles. When a `ProgramApplication` transitions to `COMPLETED`, the system can automatically log the event in the student's journey.

## Data Model

Introduce new tables to capture course completions and supporting evidence:

| Model | Description |
|-------|-------------|
| `Course` | Catalog of internal or external courses. Fields: `id`, `title`, `description`, `programId` (optional unique reference to `Program`), `sourceType` (`INTERNAL`\|`EXTERNAL`), `externalUrl`, `metadata` (JSON for arbitrary details), timestamps. |
| `StudentCourse` | Links a `User` to a `Course` with progress details. Fields: `id`, `userId`, `courseId`, `status` (`PENDING`\|`IN_REVIEW`\|`PARTIAL`\|`VERIFIED`\|`REJECTED`), `attempt` (for repeat enrollments), `completedAt`, `notes`, `verifiedBy`, `verifiedAt`, timestamps. |
| `CourseEvidence` | Optional supporting links or files. Fields: `id`, `studentCourseId`, `kind` (`VIDEO`\|`IMAGE`\|`DOCUMENT`\|`LINK`\|`TEXT`\|`FILE`), `url`, `description`, `metadata` (JSON), timestamps. |

### Program Integration

- When a `ProgramApplication` is marked `COMPLETED`, upsert a `Course` record keyed by `programId` so internal program metadata is reused instead of duplicated.
- Automatically insert a `StudentCourse` for the user. If the student repeats the program, increment `attempt` or create a new record based on business rules.
- Internal programs therefore appear on the timeline without extra student action, while external courses can still be logged manually.

### Verification Workflow

- `status` defaults to `PENDING` and transitions to `IN_REVIEW` when submitted for validation.
- Roles granted the `VERIFY_STUDENT_COURSE` permission (e.g., mentors, admins) may update entries to `PARTIAL`, `VERIFIED`, or `REJECTED` and add `verifiedBy`/`verifiedAt` metadata.
- Notes from both students and verifiers can be stored for context.

## UI/UX

1. **Student Timeline**
   - Accessible from the dashboard.
   - Displays `StudentCourse` entries in chronological order.
   - Each entry shows course title, status, notes, and any attached evidence.

2. **Add Course Flow**
   - Modal or page where students search existing `Course` records or add an external course.
   - Form collects completion date, notes, and evidence links.

3. **Evidence Management**
   - Students can attach multiple `CourseEvidence` items including videos, images, documents, or text notes.
   - Each evidence item stores a `kind` and optional `metadata` so new formats can be introduced without schema changes.
   - Files may be uploaded via the existing S3 module.

4. **Verification Interface**
   - Mentors/Admins view pending entries and move them through `IN_REVIEW`, `PARTIAL`, `VERIFIED`, or `REJECTED` states.
   - Option to leave feedback or request additional evidence.

## Backend/API Considerations

- Extend the Prisma schema with the new models and generate migrations.
- Provide CRUD API routes using the existing `modules/api` pattern for `Course`, `StudentCourse`, and `CourseEvidence`.
- Apply access control using `Role`/`UserRole` and a dedicated permission (e.g., `VERIFY_STUDENT_COURSE`) to ensure only authorized mentors or admins can verify entries.
- Trigger notifications or analytics hooks when a course is submitted or verified.

## Additional Notes

- The timeline can later integrate with existing `Program` data to show how external learning contributes to program prerequisites.
- Consider using Sanity for managing a catalog of official courses while still allowing ad‑hoc external entries.
- Maintain detailed documentation and tests for new modules, following project conventions.
- Permissions for verification should be centralized so new roles can opt in without code changes.

## Task Breakdown

- **Data Model**
  - Add `Course`, `StudentCourse`, and `CourseEvidence` models to the Prisma schema.
  - Generate and apply database migrations.
  - Link `ProgramApplication` completion events to `StudentCourse` creation.
  - Support repeat enrollments via an `attempt` field and ensure `Course` upserts by `programId`.
  - Expand enums for `StudentCourse.status` and `CourseEvidence.kind` to allow future states and evidence types.

- **API Layer**
  - Implement CRUD endpoints for `Course`, `StudentCourse`, and `CourseEvidence` using the `modules/api` pattern.
  - Enforce role‑based authorization for verification actions via a centralized permission (e.g., `VERIFY_STUDENT_COURSE`).
  - Wire notifications or analytics hooks on submission and verification.

- **UI / UX**
  - **Student Timeline**
    - Display chronological `StudentCourse` entries with status, notes, and evidence.
  - **Add Course Flow**
    - Allow searching existing courses or adding new external ones.
    - Collect completion date, notes, and evidence links.
  - **Verification Interface**
    - Provide mentors/admins a queue of pending entries.
    - Enable status updates through `IN_REVIEW`, `PARTIAL`, `VERIFIED`, or `REJECTED` with feedback.

- **Evidence Management**
  - Support attaching multiple evidence items (videos, images, documents, text notes, files).
  - Include a `kind` and optional `metadata` field so additional evidence formats can be introduced without migrations.
  - Integrate with existing S3 module for file uploads.

- **Documentation & Testing**
    - Add developer docs for new models, APIs, and UI components.
    - Create unit and integration tests covering core flows.

## Implementation Checklist

### Setup
- [ ] Upgrade to the latest Next.js version if required to use Server Actions.
- [ ] Enable Server Actions in `next.config.js`.

### Data Model
- [x] Add `Course`, `StudentCourse`, and `CourseEvidence` models in Prisma.
- [ ] Run migrations to create the new tables.
- [x] Hook `ProgramApplication` completion to automatically insert `StudentCourse` entries.

### API (Server Actions)
- [ ] Implement Server Actions for CRUD on courses, student courses, and evidence.
- [ ] Enforce role-based verification permissions inside actions.

### UI
- [ ] Build a timeline page listing `StudentCourse` entries with status and evidence.
- [ ] Provide a form to add external courses and upload evidence.
- [ ] Create a verification dashboard for mentors/admins.

### Evidence Management
- [ ] Support attaching videos, images, documents, links, text, or files.
- [ ] Use the existing S3 module for file uploads.

### Documentation & Testing
- [ ] Document models, actions, and UI flows.
- [ ] Add tests for submission and verification paths.
- [ ] Run `npm run lint`, `npm test`, and `npm run build`.

