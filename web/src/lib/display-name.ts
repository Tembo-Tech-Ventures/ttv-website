export function getFirstName(name: string | null | undefined): string | null {
  const trimmedName = name?.trim();
  if (!trimmedName) return null;

  const parts = trimmedName.split(/\s+/);
  if (parts[0] === "Fictional" && parts[1]) return `${parts[1]} (fictional)`;
  return parts[0] ?? null;
}

export function getDashboardGreetingName(
  name: string | null | undefined,
): string {
  return getFirstName(name) ?? "there";
}
