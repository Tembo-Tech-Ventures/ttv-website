import Chip from "./Chip";
import { statusTone, type StatusDomain, type StatusOf } from "./status";

type StatusChipProps<D extends StatusDomain> = {
  /** Whose status it is: an application, a feedback note, a recording… */
  domain: D;
  /** The stored value, such as `APPROVED`. */
  status: StatusOf<D>;
  className?: string;
};

/**
 * A status in its one name and tone, the same on every page: an application
 * that was `APPROVED` reads "Accepted" for the member and the admin alike.
 * The word carries the meaning; the tint only repeats it.
 */
export default function StatusChip<D extends StatusDomain>({ domain, status, className }: StatusChipProps<D>) {
  const { label, tone } = statusTone(domain, status);
  return (
    <Chip tone={tone} className={className}>
      <span data-status={status}>{label}</span>
    </Chip>
  );
}
