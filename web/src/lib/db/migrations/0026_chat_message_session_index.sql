-- Additive lookup index; safe to reapply without changing chat data.
CREATE INDEX IF NOT EXISTS `chat_message_sessionId_createdAt_idx` ON `chat_message` (`sessionId`,`createdAt`);
