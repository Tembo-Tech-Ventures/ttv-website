const labels: Record<string, string> = {
  pending: "Pending",
  queued: "Queued",
  downloading: "Downloading",
  extracting_audio: "Extracting audio",
  transcribing: "Transcribing",
  embedding: "Indexing",
  complete: "Complete",
  failed: "Failed",
};

export default function ProcessingStatus({ status }: { status: string }) {
  const tone =
    status === "complete"
      ? "bg-emerald-400/15 text-emerald-200"
      : status === "failed"
        ? "bg-red-400/15 text-red-200"
        : "bg-primary/15 text-primary";

  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>
      {labels[status] ?? status}
    </span>
  );
}
