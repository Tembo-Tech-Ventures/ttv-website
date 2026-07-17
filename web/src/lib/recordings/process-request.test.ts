import { describe, expect, it } from "vitest";
import {
  parseRecordingProcessRequest,
  RecordingProcessRequestError,
} from "@/lib/recordings/process-request";

describe("parseRecordingProcessRequest", () => {
  it("accepts strict JSON and trims the recording id", async () => {
    const request = new Request("https://ttv.test/process", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ recordingId: " recording-1 " }),
    });

    await expect(parseRecordingProcessRequest(request)).resolves.toEqual({
      recordingId: "recording-1",
      submittedAsForm: false,
    });
  });

  it("accepts a form submission", async () => {
    const formData = new FormData();
    formData.set("recordingId", "recording-2");

    await expect(
      parseRecordingProcessRequest(
        new Request("https://ttv.test/process", { method: "POST", body: formData })
      )
    ).resolves.toEqual({
      recordingId: "recording-2",
      submittedAsForm: true,
    });
  });

  it.each([
    {
      name: "malformed JSON",
      request: () =>
        new Request("https://ttv.test/process", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{broken",
        }),
    },
    {
      name: "unknown JSON fields",
      request: () =>
        new Request("https://ttv.test/process", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recordingId: "recording-1", admin: true }),
        }),
    },
    {
      name: "missing form field",
      request: () =>
        new Request("https://ttv.test/process", {
          method: "POST",
          body: new FormData(),
        }),
    },
  ])("rejects $name", async ({ request }) => {
    await expect(parseRecordingProcessRequest(request())).rejects.toBeInstanceOf(
      RecordingProcessRequestError
    );
  });
});
