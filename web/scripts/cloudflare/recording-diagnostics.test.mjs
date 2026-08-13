import { describe, expect, it, vi } from "vitest";
import {
  diagnoseRecording,
  parseRecordingDiagnosticsArgs,
} from "./recording-diagnostics.mjs";

const RECORDING_ID = "dqsqjawk2lnl0bae13g8kruf";

describe("recording diagnostics arguments", () => {
  it("accepts a bounded CUID-style recording ID", () => {
    expect(
      parseRecordingDiagnosticsArgs([`--recording-id=${RECORDING_ID}`])
    ).toEqual({ recordingId: RECORDING_ID });
  });

  it.each([
    { args: [] },
    { args: ["--recording-id=too-short"] },
    { args: ["--recording-id=UPPERCASE012345678901234"] },
    { args: ["--recording-id=../../unsafe-recording-id"] },
  ])("rejects a missing or unsafe recording ID: $args", ({ args }) => {
    expect(() => parseRecordingDiagnosticsArgs(args)).toThrow(
      "Provide a valid --recording-id"
    );
  });
});

describe("production-safe recording diagnostics", () => {
  it("queries one exact recording and returns bounded operational metadata", async () => {
    const executeQuery = vi.fn().mockResolvedValue({
      results: [
        {
          id: RECORDING_ID,
          processingStatus: "failed",
          processingError: "transcription rejected the audio",
          hasDriveSource: 1,
          hasVideoObject: 1,
          hasAudioObject: 1,
          durationSeconds: 3_600,
          fileSizeBytes: 42,
          segmentCount: 0,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      diagnoseRecording(
        { recordingId: RECORDING_ID },
        {
          resolveContext: () => ({
            environmentName: "production",
            d1Name: "ttv-website-db-production",
          }),
          findDatabase: vi.fn().mockResolvedValue({ uuid: "database-id" }),
          executeQuery,
        }
      )
    ).resolves.toEqual({
      environment: "production",
      recording: {
        id: RECORDING_ID,
        processingStatus: "failed",
        processingError: "transcription rejected the audio",
        hasDriveSource: true,
        hasVideoObject: true,
        hasAudioObject: true,
        durationSeconds: 3_600,
        fileSizeBytes: 42,
        segmentCount: 0,
        createdAt: 1,
        updatedAt: 2,
      },
    });
    expect(executeQuery).toHaveBeenCalledWith(
      "database-id",
      expect.stringContaining('WHERE r."id" = ?'),
      [RECORDING_ID]
    );
  });

  it("fails closed without creating a missing database", async () => {
    await expect(
      diagnoseRecording(
        { recordingId: RECORDING_ID },
        {
          resolveContext: () => ({
            environmentName: "production",
            d1Name: "ttv-website-db-production",
          }),
          findDatabase: vi.fn().mockResolvedValue(null),
          executeQuery: vi.fn(),
        }
      )
    ).rejects.toThrow("D1 database ttv-website-db-production was not found");
  });

  it("does not expose unrelated rows when the recording is absent", async () => {
    await expect(
      diagnoseRecording(
        { recordingId: RECORDING_ID },
        {
          resolveContext: () => ({
            environmentName: "production",
            d1Name: "ttv-website-db-production",
          }),
          findDatabase: vi.fn().mockResolvedValue({ uuid: "database-id" }),
          executeQuery: vi.fn().mockResolvedValue({ results: [] }),
        }
      )
    ).rejects.toThrow(`Recording ${RECORDING_ID} was not found in production`);
  });
});
