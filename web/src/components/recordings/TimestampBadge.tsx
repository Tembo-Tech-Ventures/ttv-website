import { formatTimestamp } from "@/lib/recordings/time-utils";

export default function TimestampBadge({
  seconds,
  href,
  onClick,
}: {
  seconds: number;
  href?: string;
  onClick?: () => void;
}) {
  const label = formatTimestamp(seconds);
  const className =
    "inline-flex shrink-0 items-center rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/25";

  if (href) {
    return (
      <a className={className} href={href}>
        {label}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick}>
      {label}
    </button>
  );
}
