/**
 * The suggest form's time zone (in-app calls P10): times are entered in the suggester's own zone. The
 * page offers Nairobi's, which works without script; where the device keeps another zone, this adds it
 * and chooses it. A zone the page already offers (after an error, say) is left as the person chose it.
 */
export function offerDeviceZone(
  root: ParentNode = document,
  zone: string | undefined = Intl.DateTimeFormat().resolvedOptions().timeZone,
): void {
  const select = root.querySelector("[data-suggest-form] select[name=zone]");
  if (!(select instanceof HTMLSelectElement) || !zone) return;
  if ([...select.options].some((option) => option.value === zone)) return;
  const option = select.ownerDocument.createElement("option");
  option.value = zone;
  option.textContent = `Your time (${zone.replaceAll("_", " ")})`;
  select.add(option);
  select.value = zone;
}
