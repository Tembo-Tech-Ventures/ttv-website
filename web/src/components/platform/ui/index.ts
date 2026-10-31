/**
 * Platform UI primitives. Brand-faithful building blocks for the spaces
 * shell, channels, attention, search and mentoring screens. See
 * `web/docs/platform-ui.md` for when to use which, and `/dev/platform-ui`
 * (dev server only) for every primitive in every state on every tone.
 */
export { default as Avatar, avatarFill, avatarFillIndex, initialsOf } from "./Avatar";
export type { AvatarMarker, AvatarProps, AvatarSize } from "./Avatar";
export { default as Button, buttonClasses } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";
export { default as Card } from "./Card";
export type { CardProps } from "./Card";
export { default as CountBadge, formatCount } from "./CountBadge";
export type { CountBadgeProps } from "./CountBadge";
export { default as IconButton, iconButtonName } from "./IconButton";
export type { IconButtonProps } from "./IconButton";
export { default as PersonMarker } from "./PersonMarker";
export type { MarkerKind, PersonMarkerProps } from "./PersonMarker";
export { default as Pill } from "./Pill";
export type { PillProps, PillTone } from "./Pill";
export { default as RoleBadge, ROLE_BADGE_KINDS } from "./RoleBadge";
export type { RoleBadgeKind, RoleBadgeProps } from "./RoleBadge";
export { default as Sheet } from "./Sheet";
export type { SheetProps } from "./Sheet";
export { default as SpaceTabs, SpaceTab, SPACE_LABELS, orderSpaces } from "./SpaceTabs";
export type { ProfileFace, SpaceTabItem, SpaceTabsProps } from "./SpaceTabs";
export { default as TemboMark } from "./TemboMark";
export type { TemboMarkProps } from "./TemboMark";
export { default as TextReaction, REACTION_KINDS, REACTION_LABELS, reactionName } from "./TextReaction";
export type { ReactionKind, TextReactionProps } from "./TextReaction";
export { SPACE_ORDER } from "./tokens";
export type { SpaceId } from "./tokens";
