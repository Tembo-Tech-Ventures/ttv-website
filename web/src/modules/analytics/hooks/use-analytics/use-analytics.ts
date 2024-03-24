import { useEffect, useState } from "react";
import type { RudderAnalytics } from "@rudderstack/analytics-js";

export const useAnalytics = (): RudderAnalytics | undefined => {
  const [analytics, setAnalytics] = useState<RudderAnalytics>();

  useEffect(() => {
    if (!analytics) {
      const initialize = async () => {
        const { RudderAnalytics } = await import("@rudderstack/analytics-js");
        const analyticsInstance = new RudderAnalytics();

        analyticsInstance.load(
          process.env.NEXT_PUBLIC_RUDDERSTACK_WRITE_KEY!,
          process.env.NEXT_PUBLIC_RUDDERSTACK_DATA_PLANE_URL!,
        );

        analyticsInstance.ready(() => {
          setAnalytics(analyticsInstance);
        });
      };

      initialize().catch((e) => console.log(e));
    }
  }, [analytics]);

  return analytics;
};
