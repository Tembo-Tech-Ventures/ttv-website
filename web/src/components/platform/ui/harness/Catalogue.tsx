import type { ReactNode } from "react";
import { PiBellSimple, PiCheck, PiFolderSimple, PiMagnifyingGlass, PiPushPin, PiTrash } from "react-icons/pi";
import {
  Avatar,
  Button,
  Card,
  Chip,
  CountBadge,
  IconButton,
  PersonMarker,
  Pill,
  REACTIONS,
  RoleBadge,
  SPACES,
  Sheet,
  TemboMark,
  TextReaction,
  type ReactionKind,
  type Space,
} from "..";
import { PEOPLE, SAMPLE_PHOTO } from "./people";

const SPACE_NAMES: Record<Space, string> = {
  cohort: "Cohort",
  community: "Community",
  mentoring: "Mentoring",
  discover: "Discover",
  admin: "Admin",
  profile: "Profile",
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-3 text-sm font-semibold text-ink-secondary">{title}</h4>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Markers() {
  return (
    <>
      {(
        [
          ["builder", "Builder"],
          ["mentor", "Mentor"],
          ["institution", "Institution"],
          ["tembo", "Tembo"],
        ] as const
      ).map(([kind, name]) => (
        <span key={kind} className="inline-flex items-center gap-2 text-sm text-ink-secondary">
          <PersonMarker kind={kind} />
          {name}
        </span>
      ))}
    </>
  );
}

function Roles() {
  return (
    <>
      <RoleBadge kind="cohort" cohort={4} />
      <RoleBadge kind="alumni" cohort={2} />
      <RoleBadge kind="mentor" />
      <RoleBadge kind="ta" />
      <RoleBadge kind="ai" />
      <RoleBadge kind="staff" />
    </>
  );
}

function Reactions() {
  const kinds = Object.keys(REACTIONS) as ReactionKind[];
  return (
    <>
      {kinds.map((kind, index) => (
        <TextReaction key={kind} kind={kind} count={[6, 4, 2, 1, 11][index]} mine={kind === "thanks"} />
      ))}
    </>
  );
}

/** Every primitive, in every state, on one space's sheet. */
function ToneSheet({ space }: { space: Space }) {
  const heading = `catalogue-${space}`;
  return (
    <Sheet space={space} as="section" aria-labelledby={heading} className="px-5 pt-6 pb-8 sm:px-8">
      <h3 id={heading} className="text-lg font-bold text-ink-primary">
        {SPACE_NAMES[space]} sheet
      </h3>
      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <Group title="Buttons">
          <Button variant="primary" icon={<PiCheck size={16} />}>
            Accept
          </Button>
          <Button variant="quiet">Suggest another</Button>
          <Button variant="ghost">Not now</Button>
          <Button variant="danger" icon={<PiTrash size={16} />}>
            Hide
          </Button>
          <Button variant="primary" size="sm">
            Send
          </Button>
          <Button variant="quiet" size="sm">
            Keep
          </Button>
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
          <Button variant="danger" size="sm">
            Remove
          </Button>
          <Button variant="primary" loading>
            Sending
          </Button>
          <Button variant="quiet" size="sm" loading>
            Saving
          </Button>
          <Button variant="primary" disabled>
            Closed
          </Button>
        </Group>
        <Group title="Icon buttons">
          <IconButton label="Search" icon={<PiMagnifyingGlass size={18} />} />
          <IconButton label="Pinned messages" icon={<PiPushPin size={18} />} variant="ghost" />
          <IconButton label="Open project" icon={<PiFolderSimple size={18} />} variant="primary" />
          <IconButton label="Pin" icon={<PiPushPin size={18} />} pressed />
          <IconButton label="Attention" icon={<PiBellSimple size={18} />} badge={4} />
          <IconButton label="Attention" icon={<PiBellSimple size={18} />} badge="dot" badgeLabel="something new" />
          <IconButton label="Search" icon={<PiMagnifyingGlass size={16} />} size="sm" />
        </Group>
        <Group title="Counts">
          <CountBadge count={2} label="new" />
          <CountBadge count={12} label="new" />
          <CountBadge count={120} label="new" />
          <CountBadge dot label="new activity" />
        </Group>
        <Group title="People">
          <Avatar id={PEOPLE.wanjiku.id} name={PEOPLE.wanjiku.name} size="xs" />
          <Avatar id={PEOPLE.achieng.id} name={PEOPLE.achieng.name} size="sm" />
          <Avatar id={PEOPLE.lucy.id} name={PEOPLE.lucy.name} size="md" />
          <Avatar id={PEOPLE.joseph.id} name={PEOPLE.joseph.name} size="lg" />
          <Avatar id={PEOPLE.amina.id} name={PEOPLE.amina.name} size="xl" />
          <Avatar id={PEOPLE.brian.id} name={PEOPLE.brian.name} size="lg" src={SAMPLE_PHOTO} />
          <Avatar id={PEOPLE.david.id} name={PEOPLE.david.name} size="md" mentor />
          <Avatar id={PEOPLE.mercy.id} name={PEOPLE.mercy.name} size="lg" mentor />
          <TemboMark size="md" />
          <TemboMark size="lg" />
        </Group>
        <Group title="Markers">
          <Markers />
        </Group>
        <Group title="Roles">
          <Roles />
        </Group>
        <Group title="Chips">
          <Chip>TypeScript</Chip>
          <Chip tone="peach" icon={<PiFolderSimple size={13} />}>
            Chama ledger · rev 3
          </Chip>
          <Chip tone="ring">Confirmed by David</Chip>
        </Group>
        <Group title="Filters">
          <Pill pressed count={3}>
            Needs a decision
          </Pill>
          <Pill pressed={false} count={8}>
            Decided
          </Pill>
        </Group>
        <Group title="Reactions">
          <Reactions />
        </Group>
        <Group title="On a card">
          <Card className="w-full">
            <p className="text-[0.9375rem] font-semibold text-ink-primary">Chama ledger: M-Pesa receipt parser</p>
            <p className="mt-1 text-sm text-ink-muted">Shared by Achieng · revision 3</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Roles />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip>D1</Chip>
              <Chip tone="peach">Session 9 · 34:12</Chip>
              <Chip tone="ring">Confirmed</Chip>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Reactions />
            </div>
          </Card>
        </Group>
      </div>
    </Sheet>
  );
}

export default function Catalogue() {
  return (
    <div className="space-y-10">
      {SPACES.map((space) => (
        <ToneSheet key={space} space={space} />
      ))}
    </div>
  );
}
