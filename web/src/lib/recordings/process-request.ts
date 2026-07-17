import { z } from "zod";

const processRecordingSchema = z
  .object({
    recordingId: z.string().trim().min(1),
  })
  .strict();

export class RecordingProcessRequestError extends Error {
  override readonly name = "RecordingProcessRequestError";
}

export async function parseRecordingProcessRequest(request: Request): Promise<{
  recordingId: string;
  submittedAsForm: boolean;
}> {
  const isJson = request.headers
    .get("content-type")
    ?.toLowerCase()
    .includes("application/json");

  let input: unknown;
  if (isJson) {
    try {
      input = await request.json();
    } catch {
      throw new RecordingProcessRequestError("Request body must be valid JSON.");
    }
  } else {
    const formData = await request.formData();
    input = { recordingId: formData.get("recordingId") };
  }

  const parsed = processRecordingSchema.safeParse(input);
  if (!parsed.success) {
    throw new RecordingProcessRequestError("recordingId is required.");
  }

  return {
    recordingId: parsed.data.recordingId,
    submittedAsForm: !isJson,
  };
}
