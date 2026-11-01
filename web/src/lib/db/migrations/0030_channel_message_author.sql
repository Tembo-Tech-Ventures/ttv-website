-- Channel posting rate limits (B-2.3, src/lib/channels/README.md): one person's recent messages,
-- in any channel, newest last. Tembo has no author, so its answers stay out of the index.
-- Additive and safe to reapply: one new index, no writes.
CREATE INDEX IF NOT EXISTS `channel_message_author_idx` ON `channel_message` (`authorId`,`createdAt`) WHERE "channel_message"."authorId" IS NOT NULL;
