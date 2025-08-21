/**
 * Server component wrapping the blog editor and performing permission checks.
 */

import { checkAdminPermissions } from "@/modules/roles/lib/check-admin-permissions/check-admin-permissions";
import { NewPostClient } from "./new-post-client";

export default async function NewPostPage() {
  await checkAdminPermissions();
  return <NewPostClient />;
}
