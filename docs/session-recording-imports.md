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
3. Keep the JSON key out of the repository and password managers or secret
   stores that do not need it. TTV needs only read access to Drive.

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

Set the impersonated user described below to the Workspace user who owns or can
read the Meet Recordings folder.

## 2. Add deployment secrets

Add these secrets independently to the GitHub `staging` and `production`
environments that should import recordings:

| Secret | Required | Value |
| --- | --- | --- |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | Yes | The complete downloaded service-account JSON |
| `GOOGLE_DRIVE_IMPERSONATED_USER` | Only for domain-wide delegation | The Workspace user's email address |

The reusable Cloudflare deployment uploads these values as encrypted Worker
secrets. It deliberately does not copy them into isolated `agent-*` previews.

Redeploy the selected shared environment after adding or rotating a secret.
Never paste the JSON key or an OAuth access token into a command, issue, SAM
message, screenshot, recording source, or database field.

## 3. Configure import sources

1. Sign in as an administrator.
2. Open **Admin -> Recordings -> Import from Drive**.
3. Add a source name, Drive folder URL or ID, target program, and optional
   case-insensitive filename filter.
4. Select **Scan now** for the initial backlog.
5. Leave the source enabled for automatic 15-minute scans.

Use one source per target program. If all Meet recordings land in one folder,
reuse the folder with distinct filename filters, such as a cohort or program
name. A Drive file is imported only once globally, so filters should not
overlap. Recordings become visible to students only through the program selected
on the source.

The initial scan lists files and queues work; it does not keep the browser open
while hundreds of videos download. The Recordings page shows each video's
progress through **Downloading from Drive**, audio extraction, transcription,
indexing, and completion.

## Operations and failures

- **No files found:** confirm the folder was shared with the service-account
  email, or that delegated access uses the correct Workspace user.
- **Google OAuth error:** verify the JSON secret. For delegated access, verify
  the numeric service-account client ID and exact read-only scope in Workspace
  Admin. Delegation changes can take time to propagate.
- **Download disabled:** Google Drive owners and shared-drive organizers can
  restrict downloads. Allow downloads for the recording.
- **Failed recording:** open its admin detail page and select **Reprocess** after
  correcting access. Drive-backed recordings download again if they never made
  it to R2.
- **Wrong program:** edit the recording after import. Changing or deleting an
  import source never deletes recordings or Drive files.
- **Pause automatic imports:** select **Pause** on the source. Manual scanning
  remains explicit; removing a source also preserves imported recordings.

Google Drive blob downloads use the official `files.get?alt=media` flow, and
only downloadable `video/*` files directly inside the configured folder are
selected. Subfolders are not traversed.
