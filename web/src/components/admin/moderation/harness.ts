import type { Message, ModerationActionKind, ModerationQueueState } from "@/lib/platform/contracts";
import { FIXTURE_NOW, channels, messages, moderationQueue, people } from "@/lib/platform/fixtures";
import type { ModerationCase } from "./case-model";

/*
 * Fixture cases for the DEV harness /dev/platform-moderation (U-2.4), in B-2.5's queue shape
 * (seq 379): one case per message, so a case's id is its message's id. The decision rules mirror
 * the contract: hide makes a message HIDDEN, restore and keep make it VISIBLE, and every decision
 * closes the case. Nothing here is reachable outside `astro dev`.
 */

const minute = 60_000;
const hour = 60 * minute;
const [flagged, reported, mentorHidden] = moderationQueue.items;

function moderated(message: Message, state: "VISIBLE" | "FLAGGED" | "HIDDEN", reasons: string[]): Message {
  return { ...message, moderation: { state, reasons } };
}

/** A fresh copy of the harness queue: four waiting, one decided. */
export function harnessCases(): ModerationCase[] {
  return [
    {
      ...flagged, id: flagged.message.id, evidence: [], review: null, decision: null,
    },
    {
      ...reported, id: reported.message.id, review: null, decision: null,
      evidence: [{ body: reported.message.body, cause: "REPORT", capturedAt: FIXTURE_NOW - 20 * minute }],
    },
    {
      ...mentorHidden, id: mentorHidden.message.id, decision: null,
      evidence: [
        { body: "This is a beginner mistake, honestly not worth anyone's time.", cause: "EDIT", capturedAt: FIXTURE_NOW - 2 * hour },
        { body: mentorHidden.message.body, cause: "HIDE", capturedAt: FIXTURE_NOW - 30 * minute },
      ],
      review: { requestedAt: FIXTURE_NOW - 12 * minute, note: "I meant the bug was a common one, not that Achieng is. I can reword it." },
    },
    {
      // A reply in a cohort thread, flagged for contact details and reported as well.
      id: "harness-moderation-reply", source: "AI_FLAG", state: "PENDING", reportCount: 1, actor: null,
      reasons: ["Contact details"], createdAt: FIXTURE_NOW - 50 * minute, evidence: [], review: null, decision: null,
      channel: channels.cohort04,
      message: moderated({
        ...messages.kevinThanks, id: "harness-moderation-reply",
        body: "Thanks! If anyone wants to pair on it later, call me on 0712 345 678.",
      }, "FLAGGED", ["Contact details"]),
    },
    {
      id: "harness-moderation-decided", source: "REPORT", state: "DECIDED", reportCount: 1, actor: null,
      reasons: ["Off topic"], createdAt: FIXTURE_NOW - 26 * hour, evidence: [], review: null,
      channel: channels.help,
      message: moderated({ ...messages.helpQuestion, id: "harness-moderation-decided" }, "VISIBLE", []),
      decision: { action: "keep", reason: "A fair question for #help.", by: people.amina, decidedAt: FIXTURE_NOW - 25 * hour },
    },
  ];
}

/** One harness run's queue, kept per run so parallel browsers never see each other's decisions. */
const runs = new Map<string, ModerationCase[]>();

export function harnessQueue(run: string, reset = false): ModerationCase[] {
  let cases = runs.get(run);
  if (!cases || reset) {
    cases = harnessCases();
    runs.set(run, cases);
  }
  return cases;
}

export function listHarnessCases(run: string, state: ModerationQueueState): ModerationCase[] {
  return harnessQueue(run).filter((item) => item.state === state);
}

export class HarnessRefusal extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Decide a case as B-2.5's moderateMessage would, or refuse it with the status asked for. */
export function decideHarnessCase(
  run: string,
  input: { messageId: string; action: ModerationActionKind; reason: string },
  failWith: number | null,
): void {
  if (failWith) throw new HarnessRefusal(failWith, "The harness refused this decision.");
  const cases = harnessQueue(run);
  const index = cases.findIndex((item) => item.id === input.messageId);
  if (index < 0) throw new HarnessRefusal(404, "No such message.");
  const item = cases[index];
  const state = input.action === "hide" ? "HIDDEN" : "VISIBLE";
  cases[index] = {
    ...item,
    state: "DECIDED",
    message: moderated(item.message, state, state === "HIDDEN" ? item.reasons : []),
    decision: { action: input.action, reason: input.reason, by: people.amina, decidedAt: Date.now() },
  };
}
