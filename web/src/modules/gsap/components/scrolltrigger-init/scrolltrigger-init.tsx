"use client";

import { useEffect } from "react";

import { gsap } from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { TextPlugin } from "gsap/TextPlugin";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, TextPlugin);

export function ScrollTriggerInit() {
  useEffect(() => {
    // if the page changes size, we need to refresh ScrollTrigger to make sure everything still works
    function refresh() {
      ScrollTrigger.refresh();
    }
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, []);
  return null;
}
