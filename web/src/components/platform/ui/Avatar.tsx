import { avatarColour, initials } from "./avatar-colour";
import { cx } from "./cx";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export const AVATAR_SIZES: Record<AvatarSize, string> = {
  xs: "size-5 text-[0.5625rem]",
  sm: "size-6 text-[0.625rem]",
  md: "size-8 text-xs",
  lg: "size-12 text-[1.0625rem]",
  xl: "size-16 text-[1.375rem]",
};

type AvatarProps = {
  /** Stable person id. The colour comes from this, never from list position. */
  id: string;
  name: string;
  /** A photo. Without one, initials on a brand colour. */
  src?: string;
  size?: AvatarSize;
  /** Mentors wear a teal ring, as they do on the homepage map. */
  mentor?: boolean;
  /**
   * The person's name is already written beside the avatar, so the picture
   * would only make screen readers say it twice.
   */
  decorative?: boolean;
  className?: string;
};

export default function Avatar({
  id,
  name,
  src,
  size = "md",
  mentor = false,
  decorative = false,
  className,
}: AvatarProps) {
  const classes = cx(
    "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-bold leading-none text-dark select-none",
    AVATAR_SIZES[size],
    mentor && "outline-2 outline-offset-2 outline-ring",
    className,
  );

  if (src) {
    return (
      <span data-avatar={id} data-mentor={mentor || undefined} className={classes}>
        <img
          src={src}
          alt={decorative ? "" : name}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      data-avatar={id}
      data-mentor={mentor || undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={classes}
      style={{ backgroundColor: avatarColour(id) }}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  );
}
