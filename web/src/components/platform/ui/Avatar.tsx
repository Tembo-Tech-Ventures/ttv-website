import { AVATAR_FILLS, cx } from "./tokens";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
/** Network markers: builders peach dots, mentors teal rings, institutions diamonds. */
export type AvatarMarker = "builder" | "mentor" | "institution";

const SIZES: Record<AvatarSize, string> = {
  xs: "size-[18px] text-[8px]",
  sm: "size-6 text-[10px]",
  md: "size-[34px] text-[13px]",
  lg: "size-12 text-[17px]",
  xl: "size-16 text-[22px]",
};

/*
 * The mentor ring is drawn as two shadows: a gap in the surface colour, then
 * the ring. `--pf-surface` is set by the enclosing Sheet; outside one the
 * ground shows through.
 */
const MENTOR_RING =
  "shadow-[0_0_0_2px_var(--pf-surface,var(--color-ground)),0_0_0_4px_var(--color-ring)]";

/**
 * A stable palette slot for an id: FNV-1a over its UTF-16 code units. The same
 * person keeps the same colour in every list, whatever their position.
 */
export function avatarFillIndex(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % AVATAR_FILLS.length;
}

export function avatarFill(id: string): (typeof AVATAR_FILLS)[number] {
  return AVATAR_FILLS[avatarFillIndex(id)];
}

/** "Wanjiku Mwangi" → "WM"; "Tembo" → "T"; blank → "?". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words.at(-1) ?? "")[0] : "";
  return `${first}${last}`.toLocaleUpperCase();
}

export interface AvatarProps {
  /** Stable person id; decides the fill colour. */
  id: string;
  name: string;
  /** Photo URL. Initials show when absent. */
  src?: string | null;
  size?: AvatarSize;
  marker?: AvatarMarker;
  /**
   * Set when the name is already written beside the avatar, so screen readers
   * do not hear it twice.
   */
  decorative?: boolean;
  className?: string;
}

/**
 * A person's picture or initials on a brand-palette disc. Mentors wear a
 * teal ring; builders and institutions carry a small corner marker.
 */
export default function Avatar({
  id,
  name,
  src,
  size = "md",
  marker,
  decorative = false,
  className,
}: AvatarProps) {
  // Exactly one element names the person: the <img> when there is a photo,
  // otherwise the disc itself. Decorative avatars name nobody.
  const discA11y = decorative
    ? { "aria-hidden": true as const }
    : src
      ? {}
      : { role: "img", "aria-label": name };
  return (
    <span
      data-avatar=""
      data-marker={marker}
      className={cx(
        "relative inline-grid shrink-0 place-items-center rounded-full font-bold text-dark select-none",
        SIZES[size],
        avatarFill(id),
        marker === "mentor" && MENTOR_RING,
        className
      )}
      {...discA11y}
    >
      {src ? (
        <img
          src={src}
          alt={decorative ? "" : name}
          loading="lazy"
          decoding="async"
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
      {marker === "builder" && (
        <span
          aria-hidden="true"
          data-corner-marker="builder"
          className="absolute -right-px -bottom-px size-[30%] min-h-1.5 min-w-1.5 rounded-full bg-primary ring-2 ring-[var(--pf-surface,var(--color-ground))]"
        />
      )}
      {marker === "institution" && (
        <span
          aria-hidden="true"
          data-corner-marker="institution"
          className="absolute -right-px -bottom-px size-[26%] min-h-1.5 min-w-1.5 rotate-45 bg-ink-primary ring-2 ring-[var(--pf-surface,var(--color-ground))]"
        />
      )}
    </span>
  );
}
