import React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import FeaturesSection from "../../src/components/homepage/FeaturesSection";
import ValuesSection from "../../src/components/homepage/ValuesSection";
// oxlint-disable-next-line import/no-unassigned-import -- Actual production styles and fonts.
import "../../src/styles/global.css";

const root = document.getElementById("root")!;
const content = <main><FeaturesSection /><ValuesSection /></main>;
// Exercise server markup hydration, matching Astro islands rather than client-only mounting.
root.innerHTML = renderToString(content);
hydrateRoot(root, content);
