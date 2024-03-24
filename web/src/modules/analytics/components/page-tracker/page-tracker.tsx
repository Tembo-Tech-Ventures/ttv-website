"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useAnalytics } from "../../hooks/use-analytics/use-analytics";
import { Suspense, useEffect } from "react";

function InnerPageTracker() {
  const analytics = useAnalytics();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (analytics) {
      analytics.page(pathname);
    }
  }, [analytics, pathname, searchParams]);

  return null;
}

export function PageTracker() {
  return (
    <Suspense fallback={null}>
      <InnerPageTracker />
    </Suspense>
  );
}
