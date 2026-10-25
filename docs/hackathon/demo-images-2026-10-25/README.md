# Fictional demo image pack

Ten images generated with Codex `image_gen.imagegen` on 25 October 2026: seven fictional adult Kenyan portraits and three fictional team, learning-space, and studio-context photographs. No scraped photos, real identities, institutional marks, or endorsements were used. The portraits are reusable illustrations, not evidence of actual students or mentors.

Review [the contact sheet](contact-sheet.jpg). Exact prompts and processing provenance are recorded in [provenance.json](provenance.json). Original generated PNGs are retained in the generation workspace; optimized project derivatives are committed under `web/public/images/demo/`.

## Integration contract

`web/public/images/demo/manifest.json` is the version 1 JSON contract agreed with the seed developer. Each entry supplies `src` (WebP), `fallback` (JPEG), intrinsic dimensions, exact byte sizes, alt text, and provenance. Portraits are 384×384; contexts are 768×512. All twenty derivatives together are 658,022 bytes. Portrait WebPs range from 11,612 to 17,100 bytes; context WebPs range from 36,034 to 78,682 bytes.

Use only `portraits` for synthetic profile avatars. Reusing seven portraits across the 150 fictional profiles must retain the demo disclosure. Contexts are optional illustrative covers and must never become project evidence, institutional affiliation claims, or user avatars. Render supplied alt text and explicit dimensions. Where the consumer supports `<picture>`, use the WebP source and JPEG image fallback; a plain image field may use the supplied WebP URL. Existing initials remain the appropriate missing-image fallback.

The developer owns bounded seed mapping, restricted to the existing synthetic-user allowlist and preserving all nonempty or human-edited images. This asset pack performs no seed writes, activation, authentication changes, or deployments. PM controls any eventual live application. Marketing review was requested but its prior task has no assigned workspace; labels and provenance are supplied here for review.

## Verification

The contact sheet was visually reviewed for crop consistency, recognizable text/logos, and obvious visual defects. Asset tests validate the agreed JSON schema, role separation, local paths, signatures, byte counts, byte budgets, alternative text, provenance, and complete derivative inventory. ImageMagick inspection verifies decoded dimensions. No live profile rendering is claimed by this asset-only change.
