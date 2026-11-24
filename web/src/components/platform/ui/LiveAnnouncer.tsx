import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "@/lib/platform/client/store";
import { createLiveAnnouncer, type LiveAnnouncerOptions, type LiveAnnouncerVoice } from "./announcer";

const AnnouncerContext = createContext<LiveAnnouncerVoice | null>(null);

/**
 * The announcer of the nearest `LiveAnnouncer`, or null outside one. Parts
 * that can speak (`Countdown`'s warnings) take it from here, so an island
 * mounts one announcer and everything inside shares its pace and memory.
 */
export function useAnnouncer(): LiveAnnouncerVoice | null {
  return useContext(AnnouncerContext);
}

/**
 * The two live regions, polite and assertive. They start empty and take each
 * message as a fresh node keyed by its id, so a screen reader reads every new
 * message, and only new ones: `after` hides what was said before a region
 * mounted.
 */
function Regions({ voice, after = 0, name }: { voice: LiveAnnouncerVoice; after?: number; name: string }) {
  const current = useStore(voice.store, (state) => state);
  const shown = current && current.id > after ? current : null;
  return (
    <div className="sr-only" data-live-announcer={name}>
      <output aria-live="polite" aria-atomic="true">
        {shown?.priority === "polite" && <span key={shown.id}>{shown.message}</span>}
      </output>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {shown?.priority === "assertive" && <span key={shown.id}>{shown.message}</span>}
      </div>
    </div>
  );
}

/**
 * The live regions again, inside an open modal `Dialog`. A modal makes the
 * rest of the page inert, live regions included, so "1 minute left" said while
 * "End for everyone?" is open would never be heard. The dialog draws these
 * while it is open; outside a `LiveAnnouncer` they draw nothing.
 */
export function DialogAnnouncements() {
  const voice = useAnnouncer();
  // Only what is said after the dialog opened: the page's regions already said the rest.
  const [after] = useState(() => voice?.store.getState()?.id ?? 0);
  return voice ? <Regions voice={voice} after={after} name="dialog" /> : null;
}

type LiveAnnouncerProps = {
  /** An announcer made with `createLiveAnnouncer`, for a caller that speaks from outside React. One is made when left out. */
  voice?: LiveAnnouncerVoice;
  /** Its pace, when it makes its own. Fixed for its life. */
  options?: LiveAnnouncerOptions;
  /** Names its regions in the DOM (`data-live-announcer`), for tests. */
  name?: string;
  children?: ReactNode;
};

/**
 * One voice for an island: draws the polite and assertive live regions and
 * hands its announcer to everything inside through `useAnnouncer()`. Mount it
 * once, near the top of the island, so the regions are in the page before
 * anything is said into them. It renders nothing visible.
 */
export default function LiveAnnouncer({ voice, options, name = "page", children }: LiveAnnouncerProps) {
  const [own] = useState(() => (voice ? null : createLiveAnnouncer(options)));
  const active = voice ?? own!;
  // The announcer it made is its own to stop; one it was given belongs to the caller.
  useEffect(() => (own ? () => own.dispose() : undefined), [own]);
  return (
    <AnnouncerContext.Provider value={active}>
      {children}
      <Regions voice={active} name={name} />
    </AnnouncerContext.Provider>
  );
}
