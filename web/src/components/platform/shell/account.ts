import { SIGN_OUT_PATH } from "./space-routes";
import type { ShellAccount } from "./AccountMenu";

/**
 * What the avatar menu offers this session, decided on the server from its
 * locals. A staging QA persona signs out by posting to its own endpoint, a
 * demo session goes back to the demo controls, and everyone else posts to
 * /auth/logout (a GET there only asks). Feedback needs a signed-in person who
 * is not a QA persona.
 */
export function shellAccount(locals: Pick<App.Locals, "user" | "stagingQa" | "stagingDemo">): ShellAccount {
  const signOut: ShellAccount["signOut"] = locals.stagingQa
    ? { kind: "form", action: "/api/qa/logout", label: "Sign out of this QA persona" }
    : locals.stagingDemo
      ? { kind: "link", href: "/demo", label: "Demo controls" }
      : { kind: "form", action: SIGN_OUT_PATH, label: "Sign out" };
  return { signOut, feedback: Boolean(locals.user) && !locals.stagingQa };
}
