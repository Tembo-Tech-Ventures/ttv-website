# Homepage second take

Raph's screenshot review called out the extreme brand scale disparity, inconsistent grid edges and motion that was too slight to notice. This revision leads with a clear Mattone message, aligns with the existing public navigation, and places one fictional contribution story beside the three audience paths. Hover or focus connects each audience to its part in that story. The brand closes the homepage as two complete, fitted lines.

Opus independently inspected staging's desktop/mobile screenshots and timed load frames before proposing this direction. The implementation review uses running browser captures as well as static screenshots. The attached PNGs are **local component-harness evidence**, with a clearly fictional example; they exclude the public navigation/footer. Full-shell staging verification follows on the pushed revision.

Motion: 950ms masked headline rise with a 100ms second-line offset; a bounded 500ms font wait; 850ms evidence entrances staggered 130ms; a scroll-linked connector; peach hover/focus sweeps with arrow rotation and corresponding evidence emphasis. Reduced motion removes transforms/entrances while preserving readable content and color feedback. No animation dependency or React hydration is added. Unsupported IntersectionObserver and disabled JavaScript preserve content and destinations.

Reproduce from `web/`:

```sh
npx playwright test --config e2e/homepage-values.config.ts
# With the component preview server running, or pass the staging homepage URL:
node scripts/homepage-motion-capture.mjs http://127.0.0.1:4322/homepage-values.html /tmp/homepage-review
```

The capture writes six real-time entrance frames, five scroll frames, hover/focus and reduced-motion screenshots, WebM recordings, and a timestamp/transform manifest. It does not pause or seek animations to manufacture the frames. Do not treat these captures as automated design approval: open and inspect them.
