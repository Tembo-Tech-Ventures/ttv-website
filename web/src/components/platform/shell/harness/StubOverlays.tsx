import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/platform/ui";
import { onShellOverlay, SHELL_OVERLAYS, type ShellOverlay, type ShellOverlayRequest } from "../overlays";

const NAMES: Record<ShellOverlay, string> = { search: "Search", attention: "Attention" };

/**
 * Harness only. Stands in for the search overlay and attention panel (U-1.3)
 * so the shell's triggers can be exercised: it shows which overlay was asked
 * for and how, and gives focus back to the trigger when it closes, as the real
 * overlays must.
 */
export default function StubOverlays() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [request, setRequest] = useState<ShellOverlayRequest | null>(null);

  useEffect(() => {
    const stops = SHELL_OVERLAYS.map((overlay) =>
      onShellOverlay(overlay, (next) => {
        setRequest(next);
        if (!dialog.current?.open) dialog.current?.showModal();
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="stub-overlay-title"
      data-stub-overlay={request?.overlay}
      onClose={() => request?.trigger?.focus()}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-sheet-community p-6 text-ink-primary backdrop:bg-black/60"
    >
      <p id="stub-overlay-title" className="text-lg font-bold">
        {request ? `${NAMES[request.overlay]} overlay requested` : "Overlay"}
      </p>
      <p className="mt-2 text-sm text-ink-secondary">
        {request?.via === "shortcut" ? "Asked for with the keyboard shortcut." : "Asked for from its button."} The real
        overlay replaces this harness stand-in.
      </p>
      <form method="dialog" className="mt-5 flex justify-end">
        <Button type="submit" variant="primary" size="sm">
          Close
        </Button>
      </form>
    </dialog>
  );
}
