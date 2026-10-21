# Timetable planning UX implementation plan

> For agentic workers: use superpowers:subagent-driven-development; preserve the existing working tree and do not commit automatically.

Goal: configurable planning hours, current-time awareness/window positioning, occurrence-scoped recurrence editing and clear Plan/Actual/delete UX while preserving lifecycle/history/notifications and existing overlap rules.
Architecture: renderer -> narrow preload -> validated IPC -> services -> repositories -> Drizzle -> local SQLite. Add only singleton planning settings and explicit excluded recurring occurrence ranges. No overdue/Missed features.
Spec: user attachment 05fe6a88-960b-4ed3-8610-614534296731.

Decisions:
- Default planning hours00:00–24:00 preserve all existing schedules; users can narrow them. Validate five-minute same-day ranges in task saved zones, and reject settings changes naming conflicting future tasks. History is not rewritten.
- Sync ON edits the parent rule using existing history-preserving cutover. Sync OFF atomically creates a standalone one-time task and excludes original exact planned range. Never copy actual history into the detached task; preserve meaningful old history on parent. Meaningful original actual history remains on the parent when detached; replacement is a fresh Planned occurrence without copied actual timestamps.
- User clarified: prioritize about10 visible hours and permit lower dynamic density. Calculate density from available scrollport height, preserving a linear scale for all task ranges. Clamp default window to current display workArea. Initial/window-visible recenter only; timer updates current-time line without scrolling. Out-of-window historical/foreign-zone blocks extend displayed range visibly rather than disappearing.

Tasks:
- [x] Backend recurrence exclusion migration/schema/repository/projection/reminder validation/detach API with restart/history tests.
- [x] Planning settings DTO/pure validators/repository/service/conflict detection tests and migration schema coordinated with backend owner.
- [x] Form: default1h end, preserve duration until manual end edit; occurrence sync ON/OFF; settings form; detail/history Planned vs Actual and delete confirmation.
- [x] Integrate narrow IPC/preload/window-visible event and workArea sizing; update App selection context/settings/edit save.
- [x] Timetable configurable range/current-time line/today outline/show-only recenter, retain overlap/lifecycle/tiny geometry; pure positioning tests.
- [x] Run full TypeScript/ESLint/tests/build, review code, isolated packaged Electron QA. No NSIS/real userData access.
- [x] Update model/developer docs and report any residual decisions.

Verification:103 automated tests, TypeScript, ESLint, production build; isolated final packaged UI evidence planning-ui-ITZrVz and installed-Scdnvz. Reviewer findings on seasonal validation and Planned/Actual pairing fixed with regressions; re-review found no critical issues. No NSIS or real userData access.
