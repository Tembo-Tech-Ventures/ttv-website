/**
 * The loading mark for buttons. It turns only when motion is welcome; under
 * reduced motion it is a still, open ring, and the button's `aria-busy` and
 * "working" text carry the state either way.
 */
export default function Spinner() {
  return (
    <span
      aria-hidden="true"
      data-spinner
      className="size-4 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
    />
  );
}
