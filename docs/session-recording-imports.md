# Session recording imports

TTV can import Google Meet recordings from Google Drive without routing video
through another compute provider. A Cloudflare Cron Trigger scans configured
folders every 15 minutes, queues new Drive files, streams them into R2, and then
uses the existing recording pipeline:

```text
Google Drive -> Cloudflare Queue -> R2 -> FFmpeg Container
             -> Workers AI transcription -> D1 + Vectorize
             -> Sessions viewer and Ask AI
```

The importer is idempotent: each Google Drive file ID can create only one
recording. Repeated scans skip recordings that are already queued, processing,
complete, or failed. A pending recording is queued again if an earlier Queue
publish did not finish.

## 1. Create the Google service account

1. In a Google Cloud project, enable the
   [Google Drive API](https://developers.google.com/workspace/drive/api/guides/enable-sdk).
2. Create a service account and download a JSON key.
3. Keep the JSON key out of the repository. TTV needs only read access to Drive.

The simplest access model is folder sharing:

1. Read `client_email` from the downloaded JSON.
2. Share the Google Meet Recordings folder with that address as a **Viewer**.
3. Do not grant editor access. The importer never modifies or deletes Drive
   files.

If Workspace policy prevents sharing with the service account, a Workspace
super administrator can instead configure
[domain-wide delegation](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority)
for this one scope:

```text
https://www.googleapis.com/auth/drive.readonly
```

Set the impersonated user in Admin -> Integrations to the Workspace user who
owns or can read the Meet Recordings folder.

## 2. Deployment secret

The only deploy-time secret required for Google Drive imports is:

| Secret | Required | Value |
| --- | --- | --- |
| `CREDENTIALS_ENCRYPTION_KEY` | Yes | 32 random bytes, base64-encoded (master encryption key) |

No `GOOGLE_DRIVE_*` secrets are needed. The Google service-account JSON is
pasted into the admin UI and encrypted at rest using the master key.

## 3. Configure credentials

1. Sign in as an administrator.
2. Open **Admin -> Settings -> Integrations**.
3. Paste the service-account JSON file contents. Optionally set the
   impersonated user email for domain-wide delegation setups.
4. Click **Save**. The JSON is validated (must be `type: "service_account"`,
   with string `client_email` and `private_key`), encrypted, and stored in D1.
   It is never echoed back to any client after saving.
5. Use **Test connection** to verify Drive access. Results show per-folder
   pass/fail with Google error codes only — no tokens or raw error bodies are
   ever displayed.

## 4. Configure import sources

1. Open **Admin -> Recordings -> Import from Drive**.
2. Add a source name, Drive folder URL or ID, target program, and optional
   case-insensitive filename filter.
3. Click **Review historical import**. TTV scans the folder tree and shows how
   many videos are new, pending a retry, or already known without creating any
   recordings yet.
4. If the count looks right, click **Add _N_ to queue**. TTV scans once more and
   refuses the import if the approved count changed in the meantime.
5. New sources start paused. Enable the source after the historical import to
   begin automatic 15-minute scans for later recordings.

Use one source per target program. If all Meet recordings land in one folder,
reuse the folder with distinct filename filters (e.g. a cohort or program
name). A Drive file is imported only once globally, so filters should not
overlap. Recordings become visible to students only through the program selected
on the source.

Folder scans traverse nested folders and follow Drive shortcuts to folders or
videos. Duplicate shortcuts to the same Drive file are imported only once.
After confirmation, the videos download asynchronously; the browser does not
stay open while a large backlog is processed. The Recordings page shows each
video's progress through **Downloading from Drive**, audio extraction,
transcription, indexing, and completion.

## Operations and failures

- **No files found:** confirm the folder was shared with the service-account
  email, or that delegated access uses the correct Workspace user.
- **Credentials not configured:** open Admin -> Settings -> Integrations and
  paste the service-account JSON. Ensure `CREDENTIALS_ENCRYPTION_KEY` is set
  in the Worker environment.
- **Google OAuth error:** verify the JSON in Integrations. For delegated access,
  verify the numeric service-account client ID and exact read-only scope in
  Workspace Admin. Delegation changes can take time to propagate.
- **Download disabled:** Google Drive owners and shared-drive organizers can
  restrict downloads. Allow downloads for the recording.
- **Failed recording:** open its admin detail page and select **Reprocess** after
  correcting access. Drive-backed recordings download again if they never made
  it to R2.
- **Wrong program:** edit the recording after import. Changing or deleting an
  import source never deletes recordings or Drive files.
- **Pause automatic imports:** select **Pause** on the source. Manual scanning
  remains explicit; removing a source also preserves imported recordings.

Google Drive blob downloads use the official `files.get?alt=media` flow. Only
downloadable `video/*` files found in the configured folder tree are selected.
