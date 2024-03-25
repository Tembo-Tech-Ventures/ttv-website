import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { ClientIdentifier } from "./components/client-identifier/client-identifier";

export async function Identifier() {
  const session = await getServerSession();
  return <ClientIdentifier session={session} />;
}
