---
name: ttv-ui-motion
description: Design, implement, or critique TTV interfaces and expressive web animation while preserving the site's established visual voice. Use for page composition, layered cards, scroll scenes, transitions, and interaction polish; not for unrelated functional fixes.
---

# TTV UI and motion

Design a coherent visual performance with a readable resting composition.
This skill supports the user's requested scope; it grants no deployment or
redesign authority. Awwwards is a craft aspiration, never a quality claim.

## Establish the visual premise

Inspect the rendered homepage and relevant destination at desktop and phone
sizes, including their motion. Read [the TTV reference](references/ttv-direction.md)
when working in this repository. Examine relevant components and history,
not just the palette. Identify which relationships make the established design
distinctive and which are incidental implementation choices.

Before editing, write a short motion brief that names:

- The feeling and visual metaphor in ordinary words, without effect names.
- The focal subject, its surroundings, and what the movement communicates.
- The resting composition and the action that leads into and out of it.
- What becomes connected, separated, exposed, aligned, or transferred. Describe
  the beginning, maximum change, and rest in plain language.
- Key beats: anticipation, main gesture, handoff, resolution. Omit any beat
  that adds waiting rather than meaning.
- What changes on touch and reduced motion, and what stays immediately usable.
- An observable rejection criterion, such as "reject if these read as three
  unrelated panels flying in." Choose the principal gesture and name which
  surrounding elements stay quiet.

An idea must explain why these particular objects move this particular way.
"Fade, blur, stagger, parallax" is a list of mechanisms, not a direction.
Choose a character suited to the content: confident, tactile, curious, calm,
or energetic are different performances. Do not give everything the same
personality merely because it shares a component.

## Compose in time

Design silhouette, spacing, contrast, and focal path during the gesture.
The next action should inherit attention from the previous one. Keep an anchor
where continuity helps; let a deliberate cut do its job where it does not.
Give primary movement room by quieting secondary movement.

Use timing contrast and overlapping phrases. A slight rotation may resolve
before position; a shadow may tighten at contact; a linked detail may react
after the main gesture. Those are examples, not mandatory effects. An evenly
spaced sequence of identical tweens needs a content-specific reason.

Make depth perceptible through coherent scale, perspective, occlusion, light,
and relative movement. Material can be graphic or physically suggestive, but
its behavior needs consistent rules. A paper file, rigid panel, elastic surface,
and optical projection should not all move alike. Avoid automatic bounce.
Keep blur brief and purposeful: velocity, focus, or transformation should
explain it. Never obscure the reading surface merely to make the animation last.

Motion must serve the layout. Rework underlying geometry when needed;
do not mask incoherent edges with blur, overflow clipping, or reduced opacity.
Conversely, do not flatten a strong expressive idea solely to satisfy a geometry
assertion written for the previous design. Update tests around user invariants.

## Build behavior, not just an intro

Define first paint, arrival, rest, interaction, interruption, and return.
Keep content available without JavaScript and under reduced motion. Prevent
finished content flashing before enhancement, and provide recovery if setup
fails. Bound the hidden interval even if font readiness never resolves. Test
slow fonts/modules on the actual server-rendered route.

Interactive motion should respond during input and settle predictably when
input stops. Hover-only decoration must not impersonate an unavailable control.
Do not turn a reading illustration into a mandatory carousel or extra click
journey. A decorative figure must not suggest selection, dragging, live review,
or completion that it cannot perform. On touch, preserve ordinary scroll and readable content.
Use bounded interactions, and stop animation work once it no longer helps.

Choose tools already in the project when they express the idea cleanly. CSS,
WAAPI, SVG, or an existing timeline library are implementation options; adding
a library or shader is not evidence of creativity. Preserve container geometry,
focus behavior, cleanup, and performance across responsive layouts.

## Review with two separate judgments

**Creative review:** watch the recording at normal speed first. Describe what
the eye follows and what the gesture feels like. Inspect selected frames around
takeoff, maximum separation, overlap/contact, and resolution. Transient smear
can be intentional; accidental border intersections and confused ownership
cannot. Compare against the brief and homepage. Name an actual weakness
and revise the gesture or composition, rather than only tuning milliseconds.

**Functional review:** exercise real routes on desktop and mobile, keyboard,
scroll in both directions, viewport changes, motion preferences, failed/slow
enhancement, and return navigation. Assert readability, containment, correct
ordering, no unwanted replay, and complete restoration/cleanup. Include
behavior-specific automated tests. Passing tests establish correctness, not taste.

For a substantial visual change, use an independent local critic when authorized.
Give them the brief, actual recordings, and relevant context. Ask what feels
generic, weightless, incoherent, or off-brand and where specifically it happens.
Do not give them a self-awarded score or ask them to endorse "award quality."
Address material findings, then review the revised artifact. If independent
review is unavailable, state that limitation rather than inventing it.

Read [creative-motion research](references/creative-motion.md) when developing a
new direction or diagnosing polished-but-generic motion. Borrow the reasoning
behind examples, not their signature visuals. Name the principle informing the
current decision and the signature treatment deliberately left behind.

Handoff should explain the idea, observed refinements, validation, and remaining
limits. Link the skill and evidence. Report aesthetic judgments as judgments;
the user remains the judge of the design.
