# Server Actions Overview

This project uses [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations) instead of REST API routes. All mutations previously routed through `/api` now call dedicated async functions defined under `src/actions`.

Each action performs a single database or storage operation and can be imported directly into client components using the `use server` directive. This approach reduces network requests and keeps logic close to React components.

The available actions include:

- `programRole.ts` – manage program role assignments.
- `programApplication.ts` – create and update applications.
- `user.ts` – update user profiles and admin fields.
- `file.ts` – upload and delete files using signed S3 URLs.

Refer to the action source files for detailed documentation.
