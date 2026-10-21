# Actual geometry and recurring occurrence correction

- [x] Add shared display-range policy: planned fallback, actual start for running, actual range for finished; current execution extends past plan. Keep planned identity and historical values.
- [x] Query records whose actual ranges reach a browsed week, merging only current-rule matching occurrences, including moved one-time tasks without creating stale-rule cards.
- [x] Add semantic correct-occurrence IPC/service entry. Recurring editor correction atomically creates a copied one-time Task, inserts exact-range exclusion and moves the original occurrence (including linked slots), with edited actual values. Normal lifecycle/history APIs do not detach.
- [x] Reuse ActualTimelineEditor for selected recurring occurrences, then keep Details on the resulting standalone task. Display per-occurrence statistics before conversion.
- [x] Limit Manage recurring tasks to recurring definitions, enlarge toast sizing, update focused tests/docs.
- [x] Run TypeScript, ESLint, full tests, production build and targeted isolated Electron flows. No live database QA or installer build; schema remains unchanged.
