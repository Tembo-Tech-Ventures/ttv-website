export function getFirstName(name: string | null | undefined): string | null {
  const trimmedName = name?.trim();
  if (!trimmedName) return null;

  return trimmedName.split(/\s+/)[0] ?? null;
}

export function getDashboardGreetingName(
  name: string | null | undefined,
): string {
  return getFirstName(name) ?? "there";
}
