# Desktop polish implementation plan

> **For agentic workers:** Use focused task-by-task execution and verification. Independent window persistence and actual timeline editor domains follow the dispatching-parallel-agents workflow.

**Goal:** Improve navigation, lifecycle hierarchy, actual-time correction, feedback, window restore and keyboard use without changing schedule/history/category/overlap semantics.

**Architecture:** Reuse existing occurrence correction IPC/service/repository. Renderer derives timelines/statistics; window JSON is owned by an Electron helper. No database migration or packaging changes.

**Confirmed product choice:** Keep the latest two-region expanded card: upper region opens details, lower region controls lifecycle; top-right icon stays decorative. Keyboard focuses those existing regions independently.

- [x] Window persistence helper, safe monitor bounds, main wiring and focused tests (window agent).
- [x] Reusable one-time ActualTimelineEditor and pure shared-scale/drag/statistics helpers with tests (editor agent).
- [x] Keep timetable mounted during week navigation; previous/next retain scroll, This week/current-week window show explicitly recenter.
- [x] Add lightweight manual-popover success toasts, consistent action text and persistent inline errors; wire create/save/start/finish/reset/history/actual correction.
- [x] Integrate one-time visual comparison into TaskDetails; recurring history stays on the existing editor. Describe soft deletion accurately per task type.
- [x] Strengthen active blue and recede finished green; add clear keyboard focus and preserve upper details and lower lifecycle keyboard stops.
- [x] Verify focused unit/UI flows, then TypeScript/ESLint/full relevant suite and build; update developer docs. Use isolated QA profiles only, never real userData. No NSIS rebuild.
