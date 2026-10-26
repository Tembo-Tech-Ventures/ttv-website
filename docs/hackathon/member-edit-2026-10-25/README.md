# Member contribution edit verification

The existing own-journey editor now offers an Edit action using the existing PUT
route. The UI sends the loaded revision; an optional atomic expectedRevision
predicate prevents stale overwrites without changing legacy API callers.

Edits preserve private/institution visibility and retain historical mentor
statements on their reviewed revision. No delete, role, mentoring-request or
future-date policy change is included.

Automated evidence:
- Real SQLite: concurrent updates allow one loaded-revision save, reject the
  other with409, preserve old confirmation rows, and deny another owner's update.
- QA handler: own ledger resource and current revision remain required; stale
  update409 does not change private visibility or grant access to another member.
- Client: PUT uses the loaded revision and existing visibility, then reads the
  authoritative own journey; historical confirmations remain in the returned UI.
- Three local Playwright component cases passed:390px and1440px private-entry
  edit, one save despite a double click, retained historical-review display,
  no horizontal overflow, and conflict draft retention/reload guidance.

`edited-390.png` and `edited-1440.png` are screenshots of the actual component in
an explicitly labeled fictional local fixture. They are not authenticated staging
or GLM evidence. The completed four-persona credentials were not reissued.
