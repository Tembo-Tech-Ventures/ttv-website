"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useAnalytics } from "../../hooks/use-analytics/use-analytics";
import { useEffect } from "react";

export function PageTracker() {
  const analytics = useAnalytics();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (analytics) {
      analytics?.page();
    }
  }, [analytics, pathname, searchParams]);

  return null;
}
