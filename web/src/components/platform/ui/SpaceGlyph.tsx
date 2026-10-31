import Avatar from "./Avatar";
import type { Space } from "./spaces";

type Person = { id: string; name: string; src?: string };

/**
 * Each space's marker, in the homepage's network language: Cohort a builder's
 * dot, Community a dot beside a ring, Mentoring a ring, Discover a diamond,
 * Admin a square, and Profile the person's own avatar. Decorative: the label
 * beside it names the space.
 */
export default function SpaceGlyph({ space, person }: { space: Space; person: Person }) {
  switch (space) {
    case "cohort":
      return <span className="size-2.5 rounded-full bg-primary" />;
    case "community":
      return (
        <span className="relative h-3 w-[1.125rem]">
          <span className="absolute bottom-0.5 left-0 size-2 rounded-full bg-primary" />
          <span className="absolute top-0 right-0 size-[0.6875rem] rounded-full border-2 border-ring" />
        </span>
      );
    case "mentoring":
      return <span className="size-[0.6875rem] rounded-full border-2 border-ring" />;
    case "discover":
      return <span className="size-2 rotate-45 bg-ink-primary" />;
    case "admin":
      return <span className="size-2.5 rounded-[3px] border-2 border-primary" />;
    case "profile":
      return <Avatar id={person.id} name={person.name} src={person.src} size="xs" decorative />;
  }
}
