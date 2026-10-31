-- Additive lookup indexes; safe to reapply without changing source data.
CREATE INDEX IF NOT EXISTS `recording_program_idx` ON `recording` (`programId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transcript_segment_recording_time_idx` ON `transcript_segment` (`recordingId`,`startTime`,`id`);
