import React from "react";
import { createRoot } from "react-dom/client";
import FeaturesSection from "../../src/components/homepage/FeaturesSection";
import ValuesSection from "../../src/components/homepage/ValuesSection";
// oxlint-disable-next-line import/no-unassigned-import -- Actual production styles and fonts.
import "../../src/styles/global.css";

createRoot(document.getElementById("root")!).render(<main><FeaturesSection /><ValuesSection /></main>);
