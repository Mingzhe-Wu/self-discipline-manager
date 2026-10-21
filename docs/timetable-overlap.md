# Timetable overlap layout

## Current policy

All intersecting display intervals form transitive layout groups, including partial overlap, containment and intersections introduced by the 15-minute minimum rendered height. End-to-start touching alone does not group. A stable sort by original planned start, planned end, task ID and occurrence ID determines column assignment and default layers.

Each group uses width = 1.05 / count; two cards are 52.5% wide, three 35%, five 21%. Left offsets distribute the cards across the available day width, leaving overlap and an exposed selectable strip for each card. Single cards use full width. Later starts and strict contained cards retain higher default layers. Input data and ordering are never changed.

Hover or keyboard focus temporarily expands a card to full usable width above siblings, vertically centered on its display block without edge-based repositioning. Mouse leave restores deterministic offsets, widths and stacking. Compact cards retain category emoji and shortened title. Expansion is one continuous lifecycle-colored capsule with two independent regions: a fixed 60px information area opens details, and the full remaining lower area advances lifecycle. A full-width separator divides them; no details icon or separate action pill remains.

Card top follows the planned start. Display height is max(planned duration, 15 minutes) multiplied by the current timeline density. Five- and ten-minute tasks therefore have a fifteen-minute visual height, while their saved start/end and displayed time labels remain unchanged. Actual start/end timestamps never determine timetable geometry. Expansion remains transient and leaves the underlying display geometry unchanged.

Only the expanded lower region is the lifecycle target: Planned → In Progress → Finished → reset confirmation. Its centered labels are ▶ Press to start, ■ Press to finish and ↺ Press to reset. The upper region only opens details; both native controls stop click propagation. Reset clears actual times only after confirmation. Each hovered region alone gets a muted darkened background, weak inset shadow and local left accent; the surrounding card does not acquire a hover accent. The information region contains title/category/state/planned range and has no reserved icon space. Short-card hover exposes the full controls without changing task data.

Current verification: 114 automated tests, TypeScript, ESLint and production build passed. Tests cover deterministic overlap groups, exposed staggered columns, the short-card visual floor and immutable planned geometry. An isolated Playwright Electron check verified rendered width/height, hover expansion, 28px details, centered sync checkbox and past one-time creation rejection. QA profiles and screenshots remain under ignored release/verification; no real user database or installer rebuild is required.

Current UI follow-up: viewport density targets eight hours (480 minutes) while keeping proportional positions and scrollable remaining time. The 100ms whole-capsule expansion remains, and lifecycle actions stay locked until animation completion; Ctrl collapses/blocks both regions. Focused verification ran 10 card/viewport tests, regional Electron interaction checks, changed-file ESLint and TypeScript/production build; no packaging or migration QA was run for this follow-up.
