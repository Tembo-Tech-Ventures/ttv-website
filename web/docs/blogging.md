# Blogging System

This document outlines how the blog feature is wired into the platform.

## Posts

- Admin users compose posts at `/admin/blog/new` using a Markdown editor and can
  revisit existing entries from `/admin/blog` where posts may be edited or
  deleted.
- The admin sidebar links directly to `/admin/blog`, which presents all posts in
  a sortable table for quick management.
- Content is stored in Postgres via Prisma using the `BlogPost` model. Each post
  records the author, title, slug and raw Markdown content.

## Images

Images uploaded through the editor are resized to 1200px width and stored in an
S3-compatible bucket (Tigris object storage). Configure the following environment
variables to enable uploads:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `S3_PUBLIC_BASE_URL` *(optional; defaults to standard S3 URL)*

## RSS

An RSS feed is served from `/blog/rss.xml` so consumers can subscribe to updates.

## Migrations

The build process attempts to apply Prisma migrations but skips them if the
database is unreachable. After provisioning your Postgres instance, run the
following command to bring the schema up to date:

```
npm run migrate:deploy
```
