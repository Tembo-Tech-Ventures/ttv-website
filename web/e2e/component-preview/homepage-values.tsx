import React from "react";
import { renderToString } from "react-dom/server";
import HomeIntroduction from "../../src/components/homepage/HomeIntroduction";
// oxlint-disable-next-line import/no-unassigned-import -- Production typography and tokens.
import "../../src/styles/global.css";

// Static markup, matching Astro's server-only React rendering. No hydration.
document.getElementById("root")!.innerHTML = renderToString(<main><HomeIntroduction isAuthenticated={new URLSearchParams(location.search).has("signed-in")} /></main>);
