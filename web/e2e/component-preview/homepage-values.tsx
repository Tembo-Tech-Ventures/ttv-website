import { initHomepageMotion } from "../../src/components/homepage/motion";
import fontGate from "../../src/components/homepage/HomeMotionGate.astro?raw";
import React from "react";
import { renderToString } from "react-dom/server";
import HomeBrand from "../../src/components/homepage/HomeBrand";
import HomeIntroduction from "../../src/components/homepage/HomeIntroduction";
// oxlint-disable-next-line import/no-unassigned-import -- Production typography and tokens.
import "../../src/styles/global.css";

// Execute the same pre-paint gate before inserting server-equivalent markup.
const gate = document.createElement("script");
gate.textContent = fontGate.match(/<script is:inline>([\s\S]*?)<\/script>/)![1];
document.head.appendChild(gate);
// Static markup, matching Astro's server-only React rendering. No hydration.
document.getElementById("root")!.innerHTML = renderToString(<main><HomeIntroduction isAuthenticated={new URLSearchParams(location.search).has("signed-in")} /><footer className="home-container"><HomeBrand /></footer></main>);

initHomepageMotion(document.querySelector<HTMLElement>(".home-introduction")!);
