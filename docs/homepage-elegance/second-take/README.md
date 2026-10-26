# Homepage second take

Raph's screenshot review called out the extreme brand scale disparity, inconsistent grid edges and motion that was too slight to notice. This revision leads with a clear Mattone message, aligns with the existing public navigation, and places one fictional contribution story beside the three audience paths. Hover or focus connects each audience to its part in that story. The brand closes the homepage as two complete, fitted lines.

Opus independently inspected staging's desktop/mobile screenshots and timed load frames before proposing this direction. The implementation review used running browser captures as well as static screenshots. The attached PNGs are **actual full-shell staging evidence at 15d74a1**, with a clearly fictional example. The subsequent observer correction skips already-visible content to avoid a startup blink; it does not change these settled layouts.

Both agents inspected desktop/mobile screenshots and running animation frames. Opus captured 88 frames at 60fps during implementation, then independently reviewed staging. On mobile with cache disabled, 300ms latency and approximately 1.6Mbps throughput, its first painted frame already used Mattone/Maven; the entrance played once continuously from 1.94s to 2.79s, without font swap or replay. The final small correction prevents initially-visible sections from dimming when the observer attaches. Public builder/post sections were empty on staging, so those data-driven sections could not be visually reviewed.

Motion: 950ms masked headline rise with a 100ms second-line offset; a bounded 500ms font wait; 850ms evidence entrances staggered 130ms; peach connectors and dots drawn once as each stage arrives; peach hover/focus sweeps with arrow rotation and corresponding evidence emphasis. Reduced motion removes transforms/entrances while preserving readable content and color feedback. No animation dependency or React hydration is added. Unsupported IntersectionObserver and disabled JavaScript preserve content and destinations.

Reproduce from `web/`:

```sh
npx playwright test --config e2e/homepage-values.config.ts
# With the component preview server running, or pass the staging homepage URL:
node scripts/homepage-motion-capture.mjs http://127.0.0.1:4322/homepage-values.html /tmp/homepage-review
```

The capture writes six real-time entrance frames, five scroll frames, hover/focus and reduced-motion screenshots, WebM recordings, and a timestamp/transform manifest. It does not pause or seek animations to manufacture the frames. Do not treat these captures as automated design approval: open and inspect them.
