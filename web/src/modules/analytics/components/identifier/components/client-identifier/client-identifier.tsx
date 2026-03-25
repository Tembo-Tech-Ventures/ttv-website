"use client";

import { useAnalytics } from "@/modules/analytics/hooks/use-analytics/use-analytics";
import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { useEffect } from "react";

interface ClientIdentifierProps {
  session: Awaited<ReturnType<typeof getServerSession>>;
}

export function ClientIdentifier({ session }: ClientIdentifierProps) {
  const analytics = useAnalytics();

  useEffect(() => {
    if (analytics && session?.user) {
      analytics.identify(session.user.id, {
        email: session.user.email ?? undefined,
        name: session.user.name ?? undefined,
      });
    }
  }, [analytics, session?.user]);

  return null;
}
