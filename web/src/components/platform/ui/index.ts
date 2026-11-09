/*
 * The TTV UI kit: every primitive the platform is built from, for React
 * islands and, rendered without a `client:` directive, for `.astro` pages.
 * docs/design-system/ is the guide; /style-guide shows each part live.
 */
export { default as Avatar, type AvatarSize } from "./Avatar";
export { avatarColour, initials } from "./avatar-colour";
export { default as BackLink } from "./BackLink";
export { default as Button } from "./Button";
export { default as ButtonLink } from "./ButtonLink";
export { default as Card } from "./Card";
export { default as Chip } from "./Chip";
export { default as ConfirmStep } from "./ConfirmStep";
export { CONFIRM_PARAM, confirmHref, confirmingAction, withoutConfirm } from "./confirm";
export { default as CountBadge } from "./CountBadge";
export { default as DataList, DataListItem } from "./DataList";
export { default as DataTable, DataCell, DataRow, DataSelectCell, RowAction, type DataColumn } from "./DataTable";
export { default as DescriptionList, DescriptionItem } from "./DescriptionList";
export { default as Disclosure } from "./Disclosure";
export { default as EmptyState } from "./EmptyState";
export {
  Checkbox,
  ChoiceCard,
  ChoiceGroup,
  FileField,
  PrefixField,
  SelectField,
  TextAreaField,
  TextField,
  fieldAria,
  fieldId,
  type FieldOption,
  type FieldOptionGroup,
} from "./Field";
export { default as IconButton } from "./IconButton";
export { default as Menu, MenuItem, MenuSection, MenuSeparator } from "./Menu";
export { default as Notice, type NoticeAnnounce, type NoticeTone } from "./Notice";
export { default as PageHeader } from "./PageHeader";
export { default as PageTitle } from "./PageTitle";
export { default as PersonMarker, type PersonKind } from "./PersonMarker";
export { default as Pill } from "./Pill";
export { default as PillNav, type PillNavItem } from "./PillNav";
export { default as Pager } from "./Pager";
export { default as RoleBadge } from "./RoleBadge";
export { default as SecretValue } from "./SecretValue";
export { default as Sheet, type SheetTone } from "./Sheet";
export { default as SpaceFile, type SpaceTabItem } from "./SpaceFile";
export { default as SpaceGlyph } from "./SpaceGlyph";
export { SPACES, type Space } from "./spaces";
export { default as Spinner } from "./Spinner";
export { default as StatusChip } from "./StatusChip";
export { STATUSES, statusTone, type StatusDomain, type StatusLook, type StatusOf } from "./status";
export { default as TabFile, type FileTab } from "./TabFile";
export { default as TemboMark } from "./TemboMark";
export { default as TextReaction, REACTIONS } from "./TextReaction";
export { cx } from "./cx";
export {
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  CHOICE_BOX,
  CONTROL,
  CONTROL_HEIGHT,
  FIELD_ERROR,
  FOCUS_RING,
  HINT,
  INSET_FOCUS_RING,
  LABEL,
  buttonClass,
  linkClass,
  pillClass,
  type ButtonRecipe,
  type ButtonSize,
  type ButtonVariant,
} from "./recipes";
export { CHIP_TONES, RAISED, type ChipTone } from "./tones";
