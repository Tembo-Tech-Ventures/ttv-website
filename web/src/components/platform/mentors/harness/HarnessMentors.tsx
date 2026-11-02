/**
 * DEV harness only (/dev/platform-mentors): the mentor connection islands on
 * fixture data, over the stateful mentoring mock (S-4.1), which behaves like
 * B-4.1 for this person. Exposes `window.__mentorsHarness` so a browser test
 * can make the next writes fail (to see the rollback) or play the other side
 * of a request.
 */
import { useState } from "react";
import type { MentorRequestCheck, MentorRequestStatus, PersonSummary } from "@/lib/platform/contracts";
import { createMentoringMock, type MentoringMock } from "@/lib/platform/client/mentoring.mock";
import type { MockReply } from "@/lib/platform/client/mockTransport";
import AvailabilityEditor, { type AvailabilityEditorProps } from "../AvailabilityEditor";
import MentorRequestsQueue, { type MentorRequestsQueueProps } from "../MentorRequestsQueue";
import MentorsDirectory, { type MentorsDirectoryProps } from "../MentorsDirectory";

declare global {
  interface Window {
    __mentorsHarness?: {
      /** Refuse the next `count` writes (POST or PUT) with this status and error code. */
      refuseWrites: (count: number, status: number, code: string) => void;
      /** The other side moves a pending request (a withdrawal behind the mentor's back). */
      move: (requestId: string, status: Exclude<MentorRequestStatus, "PENDING">) => void;
      /** Every request the mock holds, for assertions. */
      requests: () => ReturnType<MentoringMock["requests"]>;
    };
  }
}

type Harness =
  | { view: "directory"; props: Omit<MentorsDirectoryProps, "api"> }
  | { view: "requests"; props: Omit<MentorRequestsQueueProps, "api"> }
  | { view: "availability"; props: Omit<AvailabilityEditorProps, "api"> };

export default function HarnessMentors({ viewer, conductAgreed, member = true, check = null, latencyMs = 250, harness }: {
  viewer: PersonSummary;
  conductAgreed: boolean;
  /** A member account (a community profile or a cohort place), which asking needs. */
  member?: boolean;
  /** The check the page put on Wanjiku's waiting request, mirrored so the island's mock agrees with it. */
  check?: { requestId: string; check: MentorRequestCheck; status?: MentorRequestStatus } | null;
  latencyMs?: number;
  harness: Harness;
}) {
  const [mock] = useState(() => {
    let refusals: { count: number; reply: MockReply } | null = null;
    const created = createMentoringMock({
      viewer, conductAgreed, member, latencyMs,
      failure: (request) => {
        if (request.method === "GET" || !refusals || refusals.count <= 0) return undefined;
        refusals.count -= 1;
        return refusals.reply;
      },
    });
    if (check) created.check(check.requestId, check.check, check.status);
    if (typeof window !== "undefined") {
      window.__mentorsHarness = {
        refuseWrites: (count, status, code) => { refusals = { count, reply: { status, data: { error: { code, message: "Refused by the harness." } } } }; },
        move: (requestId, status) => created.move(requestId, status),
        requests: () => created.requests(),
      };
    }
    return created;
  });

  if (harness.view === "directory") return <MentorsDirectory {...harness.props} api={mock.api} />;
  if (harness.view === "requests") return <MentorRequestsQueue {...harness.props} api={mock.api} />;
  return <AvailabilityEditor {...harness.props} api={mock.api} />;
}
