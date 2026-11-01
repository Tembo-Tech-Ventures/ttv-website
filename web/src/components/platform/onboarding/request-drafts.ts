import type { AccessRole } from "@/lib/platform/contracts";
import type { AccessRequestDrafts } from "@/lib/platform/client/onboarding-drafts";
import { EMPTY_DRAFT, type RequestDraft } from "./welcome-flow";

/**
 * The request step's form, as S-O.2's per-user sessionStorage drafts and
 * back. Drafts carry unsent text across "Back to your choices" and a
 * reload; they never decide anything, and the server's copy of a refused
 * post always wins over them.
 */

/** Nothing typed: the server sent a fresh form, so a stored draft may fill it. */
export function isPristine(draft: RequestDraft): boolean {
  return Object.entries(draft).every(([key, value]) => value === EMPTY_DRAFT[key as keyof RequestDraft]);
}

/**
 * The drafts for the roles on screen, laid over what is stored: a role the
 * form does not show keeps its stored text. `sent` drops the roles being
 * sent, since the server now holds them (or echoes them back if it refuses).
 */
export function mergeDrafts(stored: AccessRequestDrafts, draft: RequestDraft, roles: readonly AccessRole[], sent = false): AccessRequestDrafts {
  const next: AccessRequestDrafts = { ...stored };
  for (const role of roles) {
    if (sent) delete next[role];
    else if (role === "MENTOR") next.MENTOR = { note: draft.mentorNote, link: draft.mentorLink };
    else next.INSTITUTION = {
      note: draft.institutionNote, organisation: draft.organisation, organisationRole: draft.organisationRole,
      link: draft.institutionLink, scopeAcknowledged: draft.scope,
    };
  }
  return next;
}

export function fromStoredDrafts(stored: AccessRequestDrafts): RequestDraft {
  return {
    mentorNote: stored.MENTOR?.note ?? "",
    mentorLink: stored.MENTOR?.link ?? "",
    organisation: stored.INSTITUTION?.organisation ?? "",
    organisationRole: stored.INSTITUTION?.organisationRole ?? "",
    institutionNote: stored.INSTITUTION?.note ?? "",
    institutionLink: stored.INSTITUTION?.link ?? "",
    scope: stored.INSTITUTION?.scopeAcknowledged ?? false,
  };
}

/** The form's current answers, read from its controls by name. A field the form does not show stays empty. */
export function readForm(form: HTMLFormElement): RequestDraft {
  const value = (name: string) => {
    const control = form.elements.namedItem(name);
    return control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control.value : "";
  };
  const scope = form.elements.namedItem("scope");
  return {
    mentorNote: value("mentorNote"), mentorLink: value("mentorLink"), organisation: value("organisation"),
    organisationRole: value("organisationRole"), institutionNote: value("institutionNote"), institutionLink: value("institutionLink"),
    scope: scope instanceof HTMLInputElement && scope.checked,
  };
}

/** Puts a draft into the form's controls. Fields the form does not show are left alone. */
export function fillForm(form: HTMLFormElement, draft: RequestDraft): void {
  for (const [name, value] of Object.entries(draft)) {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLInputElement && control.type === "checkbox") control.checked = value === true;
    else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.value = String(value);
  }
}
