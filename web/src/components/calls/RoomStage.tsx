import type { ReactNode } from "react";
import type { RoomParticipant } from "@/lib/meetings/room-client";
import RoomTile, { TrackVideo } from "./RoomTile";

/**
 * The stage: a shared screen comes first, with everyone in a strip under it that scrolls inside
 * itself (never the page); with nobody sharing, everyone's tiles in a grid.
 */
export default function RoomStage({ participants, hosts, audioOnly, notices }: {
  participants: readonly RoomParticipant[];
  hosts: ReadonlySet<string>;
  audioOnly: boolean;
  /** Notices above the stage: reconnecting, no host, recording failed, why sharing didn't start. */
  notices: ReactNode;
}) {
  const sharer = participants.find((person) => person.sharing);
  const tiles = (compact: boolean) => participants.map((person) => (
    <RoomTile key={person.userId} person={person} host={hosts.has(person.userId)} audioOnly={audioOnly} compact={compact} />
  ));
  return (
    <main aria-label="Call" className="flex min-h-0 min-w-0 flex-col gap-3 p-3 [grid-area:stage]">
      {notices}
      {sharer ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <figure className="relative m-0 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-ground" data-call-screen>
            {sharer.screen
              ? <TrackVideo track={sharer.screen} label={sharer.self ? "Your shared screen" : `${sharer.name}'s screen`} fit="contain" />
              : <p className="m-0 p-4 text-center text-ink-secondary">{sharer.name} is sharing their screen.</p>}
            <figcaption className="absolute bottom-2 left-2 rounded-md bg-ground/80 px-2 py-1 text-xs text-ink-primary">
              {sharer.self ? "You're sharing your screen" : `${sharer.name}'s screen`}
            </figcaption>
          </figure>
          <ul aria-label="People in the call" className="m-0 flex shrink-0 list-none gap-2 overflow-x-auto p-0 pb-1" data-call-strip>
            {tiles(true)}
          </ul>
        </div>
      ) : (
        <ul
          aria-label="People in the call" data-call-grid
          className="m-0 grid min-h-0 flex-1 list-none auto-rows-min grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-2 overflow-y-auto p-0"
        >
          {tiles(false)}
        </ul>
      )}
    </main>
  );
}
