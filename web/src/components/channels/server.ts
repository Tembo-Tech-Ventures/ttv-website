import { drizzle } from "drizzle-orm/d1";
import type { Channel, Me } from "@/lib/platform/contracts";
import * as schema from "@/lib/db/schema";
import { listChannelsFor } from "@/lib/channels/access";
import { acknowledgeConduct, getConductAcknowledgement } from "@/lib/channels/conduct";
import type { ConductActions } from "./conduct-flow";

/**
 * The channels UI's one seam to the backend lane (lib/channels, B-2.2): the
 * channels a person can read, decided by channelAccessFor, and their
 * agreement to the habits. Pages and the sidebar call only this. Callers own
 * the `channels` flag and the browser-session checks.
 */
export interface ChannelsServer {
  /** Channels this person can read, in display order, with their unread counts. */
  list(): Promise<readonly Channel[]>;
  conduct: ConductActions;
}

export function channelsServer(db: D1Database, me: Me): ChannelsServer {
  const user = { id: me.user.id };
  return {
    list: () => listChannelsFor(drizzle(db, { schema }), user),
    conduct: {
      load: () => getConductAcknowledgement(db, user.id),
      acknowledge: (version) => acknowledgeConduct(db, user.id, version),
    },
  };
}
