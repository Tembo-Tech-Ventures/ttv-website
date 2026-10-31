import { useStore } from "@/lib/platform/client/store";
import type { Announcement } from "@/lib/platform/client/announcer";
import type { Store } from "@/lib/platform/client/store";

/**
 * The two live regions an announcer speaks through, polite and assertive.
 * They stay mounted outside any dialog (a closed dialog is not rendered, and
 * would swallow its own announcements), start empty, and take each message as
 * a fresh node keyed by its id, so the same words said twice are read twice.
 */
export default function LiveRegions({ announcer, name }: { announcer: { store: Store<Announcement | null> }; name: string }) {
  const current = useStore(announcer.store, (state) => state);
  return (
    <div className="sr-only" data-live-regions={name}>
      <output aria-live="polite" aria-atomic="true">
        {current?.priority === "polite" && <span key={current.id}>{current.message}</span>}
      </output>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {current?.priority === "assertive" && <span key={current.id}>{current.message}</span>}
      </div>
    </div>
  );
}
