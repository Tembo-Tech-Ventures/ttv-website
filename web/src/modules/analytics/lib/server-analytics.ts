import RudderAnalytics from "@rudderstack/rudder-sdk-node";

export const serverAnalytics = new RudderAnalytics("-", {
  dataPlaneUrl: "https://ephemerecrjxaj.dataplane.rudderstack.com",
});
