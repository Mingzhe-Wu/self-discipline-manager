# Developer walkthrough

Use this as a reading checklist, not an API manual. Paths are relative to the project root. **Deep** means you should be able to explain the control flow and change it; **Role** means know its inputs, outputs, and when to consult it. This maps the current foundation rather than claiming a historical diff.

## Start with one request

Read `src/App.tsx` → `electron/preload.ts` → `electron/ipc/taskIpc.ts` → `electron/services/taskService.ts` → `electron/db/taskRepository.ts` → `electron/db/schema.ts`. Creating a task follows that path to SQLite; the result returns as a Promise and React updates its state. Only repositories issue application queries. Task creation includes a schedule; Start/End/corrections target an occurrence ID or validated planned start/end pair, never a whole recurring task. Shared types describe data but do not validate runtime input. See [the model and reporting guide](task-scheduling.md).

Then read `electron/main.ts` → `electron/db/database.ts` → `electron/scheduler/taskScheduler.ts` for startup and background work. Finish with `electron-builder.json` and `docs/windows-build.md` for installation.

## Electron lifecycle and bridge

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `electron/main.ts` | Main-process entry point: single-instance lock, window/tray, startup failure handling, shutdown. | Electron runs its built output via `package.json`; it calls database, IPC registration, sender validator, scheduler. | Internal `createWindow`, `showMainWindow`, `createTray`, `cleanup`, `reportFatalError`; app event handlers. No exports. | Deep |
| `electron/preload.ts` | Isolated Task-only IPC bridge; no raw Node/IPC exposure. | Main loads it; React calls electronAPI; handlers live in taskIpc. | Ten methods: list/create/update/delete, week schedule, notification enablement, list occurrences, Start, End, update actual times. | Deep |
| `src/electron.d.ts` | Renderer declarations for the bridge. | TypeScript checks React callers against shared Task/Occurrence DTOs; keep aligned with preload. | Window.electronAPI Promise signatures. | Deep |
| `index.html` | Renderer HTML entry and production Content Security Policy. | electron-vite builds it; main loads the built page; it loads `src/main.tsx`. | `#root`, module script, CSP meta tag. | Role |

Startup order: acquire lock → app ready → migrate userData database → register handlers → load window/preload → create tray → start scheduler. Quit stops scheduling before closing SQLite. Closing the window only hides it. `contextIsolation: true`, `nodeIntegration: false`; `sandbox: false` supports the existing ESM preload.

## IPC, services, and repositories

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `electron/ipc/validateSender.ts` | IPC security boundary: require the intended window, top frame, and trusted document URL. | `main.ts` creates a validator; Task IPC handlers call it before services. | `createSenderValidator`, `SenderValidator`. | Deep |
| `electron/ipc/taskIpc.ts` | All Task and occurrence request/response wiring. | Main registers once; preload invokes task:*; validates sender then calls Task service. | registerTaskIpc(validateSender), ten handlers. | Deep |
| `electron/services/taskService.ts` | Schedule validation, history-preserving edits, bounded week projection, materialization and Start/End/backfill validation. | IPC and scheduler call it; uses shared recurrence/week helpers and repository. | getAllTasks, createTask, updateTask, getWeekSchedule, listOccurrences, startOccurrence, endOccurrence, updateOccurrenceTimes, setTaskEnabled, deleteTask. | Deep |
| `electron/db/taskRepository.ts` | Task/occurrence database queries and atomic writes; no calendar rules. | Task service calls it; uses database/schema. | createTask, updateTask (atomic cutover), materializeOccurrences, ensureOccurrence, getOccurrenceAt, listOccurrences, current/next lookup, saveProgress, enabled/delete queries. | Deep |

Services and repositories sometimes share names: imports alias them or use `repository.*` to make the boundary clear. IPC does not query SQLite, and services do not show Electron notifications.

## Database, migrations, and scheduling

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `electron/db/schema.ts` | Drizzle Task and per-occurrence model. | Repositories import tables; Drizzle Kit reads it for migration metadata. | tasksTable, taskOccurrencesTable, occurrenceReminderSlotsTable, inferred TaskRecord/OccurrenceRecord. | Deep |
| `electron/db/database.ts` | Owns the native connection and migration lifecycle; publishes DB only after successful migrations. | Main initializes/closes it; repositories obtain its Drizzle handle; tests use isolated databases. | `initializeDatabase`, `getDatabase`, `closeDatabase`. | Deep |
| `drizzle.config.ts` | Development migration-generation configuration, not installed startup configuration. | Drizzle Kit reads schema and writes `drizzle/`; `dev.db` is a development target only. | Default `defineConfig` export. | Role |
| `drizzle/0000_simple_jean_grey.sql` | First persisted schema change. | Runtime migrator applies it according to the journal. | SQL creating `tasks`; no TS exports. | Role |
| `drizzle/0001_sweet_frightful_four.sql` | Reminder schema change. | Runtime migrator applies it after 0000. | SQL creating `reminders`. | Role |
| `drizzle/meta/_journal.json` | Ordered migration tags/timestamps. Required at runtime alongside SQL. | Drizzle generation updates it; runtime migrator reads it. | `entries` migration history. | Role |
| `drizzle/meta/0000_snapshot.json` | Generated Task-only schema snapshot. | Drizzle Kit uses generation metadata; not queried by application code. | Schema JSON, no functions. | Role |
| `drizzle/meta/0001_snapshot.json` | Generated Task+Reminder schema snapshot. | Drizzle Kit uses it when generating the next diff. | Schema JSON, no functions. | Role |
| `electron/scheduler/taskScheduler.ts` | Local native notifications for due Task occurrences; thirty-second polling plus startup. | Main starts/stops it; Reminder service selects/claims eligible slots; Electron delivers notifications. | startTaskScheduler, stopTaskScheduler; pending occurrence/slot map, checkOccurrences. | Deep |

The live DB is `app.getPath("userData")/data.db`, outside installed resources. Task/occurrence times are Unix milliseconds. A unique (taskId, scheduledStartAt, scheduledEndAt) persists each planned range. Tasks save their IANA time zone; recurring rules use startTime/endTime. The saved calendar rule catches up missing dates after downtime; completion changes only its occurrence. The scheduler selects the latest relevant reminder slot and acknowledges native show events; no overdue backlog is replayed. Commit all SQL/journal/snapshots; do not edit released history.

## Shared contracts and React

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `shared/types/task.ts` | Cross-process scheduling/history contracts, independent of Drizzle. | Renderer, preload/declarations, IPC, services. | Task, TaskOccurrence, ScheduledOccurrence, WeekSchedule, RecurrenceRule, CreateTaskInput, OccurrenceTarget (ID or planned start/end pair), UpdateOccurrenceTimesInput. | Deep |
| `src/main.tsx` | React bootstrap. | Loaded by HTML; mounts `App`, imports `index.css`. | `createRoot(...).render(...)` with StrictMode. | Role |
| `src/App.tsx` | Week state/navigation, notices, filter, modal routing (add/edit/details/manage), minute/focus refresh. | Bootstrap renders it; semantic APIs plus TaskForm/WeekSchedule/TaskDetails/Dialog. | App, reload/create/save/navigate; latest-week request guard, saving state and stable focus target. | Deep |
| `src/components/TaskForm.tsx` | Same structured form for Add/Edit; five-minute Start/End Time selects, weekdays, notification switch and validation. | App supplies onSave/onCancel inside Dialog; shared inputs, Temporal and formatting. | TaskForm, submit; unchanged legacy ranges survive title-only edits without rounding. | Deep |
| `src/components/WeekSchedule.tsx` | 24-hour time-positioned day columns, two-hour grid lines, viewer-midnight segments and overlapping lifecycle/range cards. | App renders it; timetableLayout computes geometry/overlap; card surface advances lifecycle by click/Enter/Space; separate details arrow stops propagation; Finished opens ResetOccurrenceDialog. | WeekSchedule, internal OccurrenceCard. | Deep |
| `src/components/TaskDetails.tsx` | Secondary summary, Edit entry, delete, collapsed history; migration explanations stay here. | App wraps it in a right-aligned Dialog; TaskHistory handles records. | TaskDetails, remove; onEdit/onBusyChange callbacks coordinate modal state. | Deep |
| `src/components/Dialog.tsx` | Native modal lifecycle, initial focus, Escape/backdrop, focus return and pending-save guard. | App uses it for Add/Edit/Details/Manage; forms opt into initial focus with a data attribute. | Dialog; showModal/close effect, stable fallbackFocus. | Deep |
| `src/components/Icon.tsx` | Small consistent inline SVG utility icons; no external font/assets. | Header, navigation, dialogs and completion controls. | Icon (calendar, plus, chevrons, close, check). | Role |
| `src/index.css` | Desktop light-theme tokens and reusable controls, dialogs, board, cards and history layouts. | Imported by src/main.tsx; styles renderer classes only. | CSS; narrow windows scroll the board while toolbar wraps. | Role |

App refreshes week projections every minute and on focus; this does not deliver notifications. The native scheduler has its own thirty-second timer. The week is derived from rules plus saved occurrence state, rather than persisting future weeks. TaskHistory loads a selected date range only after expansion and allows backfill, correction, and clearing actual times. recordedAt preserves first entry time while startedAt/endedAt are user-editable; duration is derived. Async request versions prevent old responses from replacing newer weeks. The old TaskList/TaskItem components were removed.

## Build, packaging, and project configuration

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `package.json` | Scripts, dependencies, entry point, tool versions, npm install-script policy. | npm/electron-vite/builder read it; `main` points to compiled Electron entry. | `dev`, `typecheck`, `test`, `test:installed`, `verify:native`, `build`, `pack:win`, `build:win`; `postinstall`. | Deep |
| `package-lock.json` | Exact dependency tree for reproducible `npm ci`. | npm consumes it; matches `package.json`. | Generated lock metadata; never hand-edit. | Role |
| `electron.vite.config.ts` | Active desktop build configuration for main, preload, renderer. | `electron-vite` scripts read it; points at TS/HTML entries. | Default `defineConfig`; development-only CSP transform for Vite/React Refresh. | Deep |
| `electron-builder.json` | Windows x64 unsigned NSIS packaging, stable identity, resource inclusion, ASAR/native unpacking. | `pack:win`/`build:win`; uses built `out/`, migrations, resources, production deps. | Declarative `files`, `asarUnpack`, `win`, `nsis`; no functions. | Deep |
| `scripts/verify-native.cjs` | Build-time native compatibility check, not application startup logic. | `postinstall`, `verify:native`, packaging scripts; launches pinned Electron as Node. | Parent/`--electron-child` branches; checks versions, PE x64, Node-API, real SQLite query. | Role |
| `tsconfig.json` | Coordinates renderer/tooling TS project references. | `tsc -b` in `typecheck`. | References app/node configurations. | Role |
| `tsconfig.app.json` | Renderer/JSX/DOM type-check settings. | Referenced by root config; checks `src/`. | Compiler options; cache under node_modules. | Role |
| `tsconfig.node.json` | Type-checks the separate inherited Vite config. | Referenced by root config; includes `vite.config.ts`. | Node-tooling compiler options. | Role |
| `tsconfig.electron.json` | Strict Electron/shared/desktop-config checks. | Second command in `typecheck`; includes Electron, shared types, electron-vite/Drizzle configs. | Compiler options, no emitted files. | Role |
| `vite.config.ts` | Inherited plain-Vite configuration; not the active Electron build config. | Still included by `tsconfig.node.json`; desktop npm scripts use electron-vite instead. | Default Vite config with React plugin. | Role |
| `eslint.config.js` | TS/React lint rules and generated-output exclusions. | `npm run lint`. | Default flat config. | Role |
| `.gitignore` | Local/generated-file exclusion policy. Does not delete files or determine builder contents. | Git uses it; builder has its own `files` rules. | Ignore patterns, no exports. | Role |

Native detail to remember: better-sqlite3 **13.0.3** ships a Windows x64 **Node-API 10** binary. `npmRebuild: false` and the npm install-script policy avoid an unnecessary compiler rebuild. Actual loading is verified under pinned Electron and again after installation. Read `docs/windows-build.md` before changing these versions or npm policy; ordinary application changes do not require understanding the binary-check implementation.

Resources: `resources/tray-icon.png` is loaded by main; `resources/app.ico` is the Windows packaging icon. Commit both. `public/favicon.svg` is referenced by HTML and copied to the renderer output. `src/App.css`, `src/assets/{react.svg,vite.svg,hero.png}`, and `public/icons.svg` are currently unused starter/template assets; understand their role only. This walkthrough does not remove them or change styling.

## Tests and documentation

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `tests/run.cjs` | Fast test entry: launches tests under Electron's Node runtime. | `npm test`; runs Task/weekly/planned-range/occurrence-lifecycle/security/database/application-lifecycle modules. | `spawnSync`, exit propagation. | Role |
| `tests/register-typescript.cjs` | Test-only TypeScript/TSX-to-CommonJS loader. | Imported by DB/Task/security/weekly tests; uses TypeScript. | Registers .ts and .tsx loaders (React JSX runtime for server-rendered card tests). | Role |
| `tests/tasks.cjs` | Real SQLite unified-model, history and migration tests. | npm test; services/repository/recurrence and taskScheduler. | One-time, recurring, DST, current-day, backfill/corrections, offline/delete history, restart and old-schema migration tests. | Deep |
| `tests/database.cjs` | Initialization failure, availability, double-init guard, safe close. | Test runner; calls database lifecycle with isolated DB. | One test. | Role |
| `tests/security.cjs` | Trusted main frame/window/URL checks; rejects other ports/paths/frames. | Test runner; exercises `createSenderValidator`. | Two tests. | Deep |
| `tests/lifecycle.cjs` | Startup ordering/lock, navigation denial, restoration, fatal cleanup. | Test runner; transpiles main into a VM with Electron test doubles. | Internal `boot` harness; four tests. | Role |
| `tests/windows-installed.cjs` | Packaged/installed Electron UI QA with isolated userData and real thirty-second tick. | test:installed accepts the executable path; Playwright Core drives UI and checks native loading/security/tray/restart. | main, waitFor; writes ignored reports/screenshots. Rebuild/install current sources first. | Role |
| `README.md` | Starting point for developer/build commands. | Human readers; links build/readiness/reminder docs. | No code exports. | Role |
| `docs/reminders.md` | Exact per-slot reminder windows, delivery, retries and restart policy; no separate Reminder product. | Older links redirect readers to task-scheduling.md. | No exports. | Role |
| `docs/packaging-readiness.md` | Current architecture/readiness summary and resolved review findings. | Reference for architecture discussions; links current build guide. | No code exports. | Role |
| `docs/windows-build.md` | Reproduction commands, native policy, artifact paths, verification, signing/manual limits. | Developers preparing/testing installers. | No code exports. | Deep before packaging |
| `docs/superpowers/plans/2026-10-17-windows-build.md` | Completed implementation plan and decision record. | Historical reference; not an input to npm/runtime. | Checklists/completion evidence, no exports. | Role |
| `docs/developer-walkthrough.md` | This reading map. | README/human readers; points to current code. | No code exports. | Role |

Fast tests use controlled native-notification events; installed tests forward real notification calls. A `show` event is not visual confirmation of Windows toast appearance. Temporary instrumentation belongs in tests, not in the packaged application.

## New unified-model files

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `shared/scheduling/recurrence.ts` | Pure saved-zone recurrence, positive same-day five-minute validation, and compatible DST whole-gap range shifts. | Task service and shared week helper call it; pinned Temporal polyfill handles DST. | validateRecurrence, firstOccurrenceAt, generateOccurrenceTimes, occurrenceEndAt, planned-range validators, localDateAt, localDayRange. | Deep |
| `shared/scheduling/week.ts` | Pure week navigation, local day keys, bounded rule expansion and stored-state merging by both planned endpoints. | Task service derives week DTOs; renderer groups/navigates days; tests check DST and placement. | weekRange, shiftWeek, weekDays, dayKey, expectedTimes, deriveOccurrences. | Deep |
| `tests/weekly.cjs` | Week projection and editing regression tests, including compact imported card markup. | npm test; real isolated SQLite and React server rendering. | Week/DST, bounded browsing, merge, edit/cutover/conversion, notification preference, metadata hiding tests. | Deep |
| `drizzle/0003_task_schedule_edits.sql` | Adds schedule_effective_at without rewriting existing expectations/completions. | Runtime migrator after 0002; metadata in meta/0003_snapshot.json. | SQL effective-boundary backfill; no TS exports. | Deep |
| `src/components/TaskHistory.tsx` | Date-range history plus editable actual start/end times, backfill and clear. | TaskDetails expands it; calls semantic occurrence APIs, refreshes week projections. | TaskHistory, internal OccurrenceRow/save handler. | Deep |
| `src/taskFormatting.ts` | Shared renderer date/input formatting and error text. | App, TaskForm, WeekSchedule, TaskDetails, TaskHistory. | localDateInput, localDateTimeInput, formatScheduled, errorMessage. | Role |
| `drizzle/0002_unified_tasks.sql` | Atomic data-preserving upgrade from separate Task/Reminder tables. | Runtime migrator; preserves provenance, IDs, completion/notified distinction. | Creates unified tasks/task_occurrences, maps legacy data, drops old tables after copying. | Deep |
| `drizzle/meta/0002_snapshot.json` | Generated 0002 unified schema metadata. | Drizzle Kit uses it when generating the next diff; keep committed. | Schema JSON. | Role |
| `docs/task-scheduling.md` | Model, recurrence/DST, migration, notifications, editable history, future weekly metrics. | Main reference when changing Task scheduling/history. | No exports. | Deep |
| `docs/superpowers/plans/2026-10-19-unified-tasks.md` | Refactor implementation decisions and checklist. | Historical development reference, not runtime input. | No exports. | Role |
| `docs/superpowers/plans/2026-10-19-weekly-schedule.md` | Weekly interaction/editing decisions, implementation checklist and verification ledger. | Development reference, not runtime input. | No exports. | Role |

## What to commit versus regenerate

Commit source, tests, configs, docs, resource artwork, `package.json`, `package-lock.json`, and the complete `drizzle/` history. Regenerate `node_modules/` with `npm ci`, `out/` with `npm run build`, and `release/` with `npm run build:win`. Release contents include installers, unpacked/installed copies, local SQLite test profiles, QA evidence, and builder logs; none belong in the initial source commit. `data.db` in real Electron userData is personal runtime data, not project source.

When reading tomorrow, ask: can I trace one successful request and one rejected request, explain the startup/quit sequence, distinguish UI refreshing from notification scheduling, and explain why migrations are committed but the database is not? Mark unclear files and discuss those before changing architecture.

## Lifecycle files added in this iteration

| File | Layer and responsibility | Callers / exports | Read |
| --- | --- | --- | --- |
| `shared/occurrenceLifecycle.ts` | Pure derived state and duration; imported unknown-time completions are explicit. | Renderer/services/tests; `occurrenceState`, `occurrenceDuration`. | Deep |
| `electron/services/reminderPolicy.ts` | Pure latest eligible slot/window selection. | Reminder service; `reminderSlotAt`. | Deep |
| `electron/services/reminderService.ts` | Business eligibility, current-rule checks, claims and delivery outcomes. | Scheduler; `getDueReminders`, `claimReminder`, relevance/outcome/recovery helpers. Uses Task service and repositories. | Deep |
| `electron/db/reminderSlotRepository.ts` | DB-only candidate/slot queries and conditional claims. | Reminder service; `findCandidates`, `getSlot`, `claimSlot`, `finishSlot`, `recoverInterruptedSlots`. | Deep |
| `drizzle/0004_occurrence_lifecycle.sql` | Preserves IDs/planned times, maps known legacy ends, adds durable slot table. | Startup migrator; journal and `meta/0004_snapshot.json` accompany it. | Deep |
| `tests/occurrence-lifecycle.cjs` | Lifecycle validation/duration, seven slots, failure retries, crash/restart and scheduler cleanup. | Test runner; real isolated SQLite plus controlled native events. | Deep |
| `docs/superpowers/plans/2026-10-19-occurrence-lifecycle.md` | Lifecycle implementation decisions and validation ledger. | Developer reference only. | Role |

The current board uses one compact week toolbar over a scrollable timetable with density sized for roughly eight visible hours. Add/Edit share a modal; details/history stays secondary. See [task scheduling](task-scheduling.md) for legacy exceptions and future report calculations, and [notifications](reminders.md) for seven slots and the final thirty-second grace window.

## Planned-range files

| File | Layer and responsibility | Callers / exports | Read |
| --- | --- | --- | --- |
| `src/timetableLayout.ts` | Pure viewer-local display segments, density-based geometry, connected display intersections, staggered widths, a fifteen-minute display floor and deterministic stacking. | WeekSchedule/tests; `rangeGeometry`, `splitDisplaySegments`, `layoutOverlaps`. | Deep |
| `electron/db/migrationRanges.ts` | Exact legacy start preservation; elapsed one-time ends and recurrence wall-clock ranges capped before local midnight. | Transactional runtime migration runner calls typed conversion explicitly; `legacyPlannedEnd`, `legacyRecurrenceRange`, `legacyScheduleEnd`. | Deep |
| `drizzle/0005_planned_ranges.sql` | Planned-start column rename, ends/task zone, recurrence JSON conversion, occurrence uniqueness across both endpoints. | Runtime migration runner; built-in SQLite SQL with explicit typed zone normalization before journal commit. Journal and `meta/0005_snapshot.json` accompany it. | Deep |
| `tests/planned-ranges.cjs` | Planned-input validation, exact migration preservation, DST/range identity and timetable interval/geometry coverage. | Test runner; isolated SQLite and pure shared/renderer helpers. | Deep |

New planned ranges use five-minute increments, end strictly after start, and stay on one saved-zone date. Unchanged imported ranges can be saved exactly. Actual start/end history keeps its original precision. A start/end pair identifies current state, so an end-only edit preserves meaningful old rows without carrying their progress onto the new range.

The timetable now uses planned geometry before Start, actual start/current execution while running, and actual start/end when finished; stored planned ranges remain unchanged. Viewer-midnight display splitting keeps one occurrence identity. Display intersections form transitive staggered-width groups (width 1.05 / count: two 52.5%, three 35%); each leaves an exposed selectable strip. Short blocks render at least fifteen minutes high without changing their saved planned range. Later starts remain above earlier ones. Whole-capsule hover/focus expansion is vertically centered and transient, and mouse leave restores deterministic columns/layers. See the model guide for the fixed-grid DST-fold behavior.

## Migration compatibility repair

| File | Layer and responsibility | Callers / exports | Read |
| --- | --- | --- | --- |
| `electron/db/runtimeMigrations.ts` | Atomic Drizzle SQL/hash/journal execution plus schema-aware recovery of unjournalled0005 and explicit time-zone normalization. | database.initializeDatabase; runRuntimeMigrations. No registered SQLite JS functions. | Deep |
| `tests/migration-compatibility.cjs` | Native SQL execution, old-rule history preservation, partial-DDL recovery and rollback regression tests. | npm test; isolated SQLite fixtures. | Deep |

See [migration compatibility repair](migration-compatibility-repair.md) for the real-profile incident and preservation evidence.

`tests/timetable-overlap.cjs` covers deterministic overlap layout; [timetable overlap layout](timetable-overlap.md) explains compact content, pointer/keyboard expansion and fixed geometry.

| `src/components/ResetOccurrenceDialog.tsx` | Neutral Finished → Planned confirmation, Cancel focused first, pending/error handling. | WeekSchedule opens it; existing updateTaskOccurrenceTimes clears both actual times, then refreshes the week. | ResetOccurrenceDialog; understand its role. | Role |
| `tests/card-lifecycle.cjs` | One-time/recurring reset preservation and primary/secondary card markup. | npm test; real isolated SQLite and React server rendering. | Three tests; packaged interaction QA covers clicks, cancellation and tiny cards. | Role |

Current planning extension: [planning hours and occurrence editing](planning-hours-occurrence-editing.md). Read shared/scheduling/planningHours.ts (pure clock/bounds validation), electron/services/settingsService.ts (centralized preference/profile validation), electron/db/settingsRepository.ts (singleton DB access), electron/ipc/settingsIpc.ts (sender-validated wiring), shared/types/settings.ts (DTO), src/components/SettingsPanel.tsx (section-level settings forms), src/timetableViewport.ts (density/current-time/scroll math), electron/window/windowSizing.ts (workArea bounds). Migration0006 and its snapshot add settings + exact-range recurrence exclusions. taskService.updateOccurrencePlan routes synced rule edits or atomic standalone replacement; taskRepository owns exclusion/insert transactions. App carries selected occurrence context; TaskForm handles Sync and duration defaults; Details/History separate planned and actual. Preload exposes only get/update planning hours, update occurrence plan and event-only onWindowShown subscription in addition to existing APIs. Understand services/projection/exclusions deeply; the settings form/window helper need only role-level familiarity.

## Task categories

See [category design and migration](task-categories.md). shared/taskCategories.ts defines stable keys, display metadata and validation; shared/types/task.ts carries category on Task and optional create/edit input. schema.ts + migration0007 persist it; taskService.ts validates/inherits it. TaskForm/TaskDetails/WeekSchedule use the shared definitions; index.css reserves compact emoji space without category colors. Understand the shared keys and inheritance deeply; the display mapping and generated migration snapshot only require understanding their role. tests/categories.cjs and tests/windows-categories.cjs cover data and rendered flows.

The native File/Edit/View/Window menu is removed in main.ts using BrowserWindow.removeMenu; the title bar and tray menu remain. The current-time line prefixes its clock with NOW:. Current verification: 114 automated tests, TypeScript, ESLint and production build passed, plus isolated category UI/restart checks. See task-categories.md for real-database snapshot migration evidence; this verification does not imply a new NSIS installer was built.

Latest card interaction: WeekSchedule renders a fixed 60px card-info-region (whole area opens details) and a remaining-height card-primary-button (Start/Finish/Reset). Native buttons are independent; the upper-right details icon is decorative and belongs to the upper region. index.css owns the full-width separator, centered action and region-only muted background/inset/left-accent feedback. timetableViewport.VISIBLE_PLANNING_MINUTES is 480. tests/windows-card-regions.cjs checks density, both click routes, reset, short/long and grouped restoration using an isolated profile.

## Desktop polish: navigation, actual timing and feedback

See [desktop interaction notes](desktop-polish.md) for behavior and verification. No schema, recurrence, notification or packaging change is involved.

| File | Layer and responsibility | Callers / main exports | Read |
| --- | --- | --- | --- |
| `src/actualTimeline.ts` | Pure common-scale geometry, five-minute actual-edit snapping, range validation, local time options and derived statistics. | ActualTimelineEditor/tests; `timelineScale`, `timelineBar`, `draggedActualTime`, `actualStatistics`, `localTimeOptions`. | Deep |
| `src/components/ActualTimelineEditor.tsx` / `.css` | Selected one-time/recurring planned/actual comparison, dates/selectors, draggable boundaries, optimistic save/rollback and focus restoration. | TaskDetails; existing `updateTaskOccurrenceTimes` bridge and parent refresh. | Deep |
| `src/toast.ts` | Small notification context and lifecycle success message formatting. | App, cards, history, reset and actual editor callback; `useToast`, `lifecycleToast`, `TOAST_DURATION`. | Role |
| `src/components/ToastProvider.tsx` | Bottom-right manual-popover success feedback, above native dialogs; independent 2.8-second successes and five-second Task Deleted / Undo entries. | main.tsx wraps App; no service or DB dependency. | Role |
| `electron/window/windowGeometry.ts` | Validate/restore/save normal bounds and maximized state; recover when monitors change. | main.ts; `loadWindowGeometry`, `trackWindowGeometry`. Stores userData/window-state.json. | Role; read deeply when changing window lifecycle |
| `tests/actual-timeline.cjs`, `tests/toasts.cjs`, `tests/window-geometry.cjs` | Pure/component/native-runtime regression checks for the new helpers. | tests/run.cjs; isolated fixtures only. | Role |
| `tests/windows-desktop-polish.cjs` | Real Electron navigation, editing/drag/rollback, toast, keyboard and restart checks. | Explicit manual invocation; ignored release/verification profile and screenshots. | Role |

Modified integration points: App keeps the timetable mounted across week navigation and gates recentering on accepted data plus current viewport geometry. WeekSchedule centers current-week navigation/This week/window-show on the current time and resets non-current weeks to the top. TaskDetails adds the shared occurrence editor and accurate soft-delete wording. TaskHistory and ResetOccurrenceDialog emit success feedback. index.css strengthens In Progress, softens Finished and adds keyboard focus styling. main.ts restores geometry before window creation and saves only after successful startup on normal quit. Service/Repository and migration responsibilities remain unchanged.

Keyboard follows the confirmed two-region design: Tab to upper information opens Details with Enter/Space; Tab to lower action starts/finishes/resets. Focus alone never changes state. Saving prevents repeated actions without dropping lifecycle-button focus. Actual selectors restore focus after temporary disabling unless the user deliberately moves elsewhere.

Deletion Undo: taskService.deleteTask returns TaskDeletionReceipt (shared/types/task.ts) with a five-second, one-use opaque token. undoTaskDeletion validates the token and calls repository.restoreDeletedTask, which conditionally restores the original Task notification flag without touching history/schedules/slots. taskIpc/preload/electron.d.ts expose only the semantic undoTaskDeletion API. TaskDetails passes the receipt to App, which closes Details, refreshes the schedule and registers the toast Undo callback. ToastProvider stacks entries with separate deadlines and persistent action errors. Tokens are session-local; quitting preserves deletion. Read service expiry/conditional restoration deeply; UI wiring needs role-level understanding. tests/deletion-undo.cjs and tests/windows-deletion-undo.cjs verify persistence and real UI flows.

## Actual-first display and recurring correction

| File | Layer and responsibility | Callers / exports | Read |
| --- | --- | --- | --- |
| `shared/scheduling/occurrenceDisplay.ts` | Pure lifecycle-based display range selection; never modifies planned identity. | Task service week filtering and renderer; `occurrenceDisplayRange`. | Deep |
| `src/timetableLayout.ts` | Splits the selected display range at viewer midnight and clips it to the visible week. | WeekSchedule/tests; `splitOccurrenceDisplaySegments` in addition to the existing primitives. | Deep |
| `tests/actual-scheduling.cjs` | Actual geometry, recurring editor/statistics, exact history/slot transfer, rollback, virtual exclusion and database reopen regressions. | npm test, isolated SQLite/React rendering. | Role |
| `tests/windows-actual-scheduling.cjs` | Recurring-only manager, Actual editor detachment, follow-up Details, actual card geometry, larger toast and restart UI checks. | Explicit invocation, ignored isolated release/verification profile. | Role |

Modified paths: taskService.correctOccurrenceTimes validates the visual correction; taskRepository.detachOccurrenceWithActual owns the exclusion + new Task + original history-row transfer transaction. listActualOccurrences supplies week candidates outside their planned week; the service rejects obsolete-rule candidates. taskIpc/preload/electron.d.ts expose correctTaskOccurrenceTimes narrowly. ActualTimelineEditor accepts an optional save operation and onDetached callback; TaskDetails selects it for recurring tasks, and App follows the resulting Task ID. Task Center’s Recurring chip lists series definitions; its Missed chip lists individual missed occurrences. WeekSchedule uses actual display ranges for geometry/overlap and keeps planned timestamps for identity/actions. index.css enlarges all success/Undo toasts. Understand the display selector, service branching and transaction deeply; UI wiring needs role-level familiarity. No schema or migration changed.

## Unified Task Details editing

TaskDetails now composes one information area inside ActualTimelineEditor using its `information` and `informationActions` slots. TaskForm has read-only text and inline autosave modes, reusing the same planned-schedule validation. An Edit switch at the bottom right of the main information card toggles metadata inputs in place; there is no separate Edit Task dialog. Input pauses of 400ms autosave, saves serialize without disabling typing, and turning Edit off flushes the latest draft. Invalid values keep Edit on with inline errors. There are no inline Save/Cancel buttons. The Add form is unchanged. Actual dragging/selectors remain available independently in both modes; statistics stay derived. App removes the old edit view and preserves selected occurrence context across metadata-only updates. index.css and ActualTimelineEditor.css remove the nested panel border and tighten information spacing. tests/details-edit.cjs and tests/windows-details-edit.cjs cover markup, live saves, focus, slow requests, closing, errors and independent Actual editing. Read the autosave version/queue logic deeply; the presentation slots need role-level understanding. No service/repository/schema changes were needed.

Completed/started one-time planning correction: TaskForm now locks only Schedule type, keeping planned Date/Start Time/End Time enabled. taskService.updateTask branches to taskRepository.correctOneTimePlan for progressed one-time records; one transaction updates the Task plan and its current occurrence planned endpoints, preserving actual/audit/slot identity. Other historical rows stay untouched, and duplicate-range conflicts roll back. ActualTimelineEditor keeps visual handle editing above a separate two-column exact-input area; both share its existing Actual state. ActualTimelineEditor.css owns the shared scale and two-layer layout. tests/actual-scheduling.cjs covers preservation and rollback; tests/windows-completed-plan.cjs covers the rendered/edit interactions. No schema/migration change.

ActualEndpointControl.tsx is the renderer-only exact-time field: click/keyboard opens the existing native date/time options. The lower two-column input area is independent of the upper drag surface; time fields no longer follow handles or start pointer drags. ActualTimelineEditor owns the shared Actual preview used by both inputs and handles, existing validation, five-minute snapping, release-only persistence, cancellation and held-edge extension bounded by each endpoint's local day (00:00–23:55). The upper visualization contains shared-scale ticks, read-only Planned range, Actual handles and live endpoint markers. Its lower exact-input section contains the selectors, help and Clear actual times. Understand preview/persistence and pointer cleanup deeply; layout and decorative ticks need role-level familiarity. tests/details-edit.cjs checks layer separation; tests/windows-actual-buttons.cjs checks both synchronization directions, one save on release, invalid end rejection, edge extension, cancellation and day limits in an isolated profile.

Task Details visual structure: `ActualTimelineEditor.tsx` keeps its existing preview/save/drag state and renders three presentation cards. The first groups the `TaskForm` information slot and Planned/Actual timestamps; its `informationActions` slot places Edit at the bottom right. The second holds the five derived Timing summary tiles. The third contains the shared-scale Planned/Actual chart, separate exact-time fields and existing clear/backfill controls. `TaskDetails.tsx` currently omits the History disclosure and keeps deletion in a separate bottom section; stored history and APIs remain intact. `TaskDetails.css` owns the detail-specific spacing, compact inline form, content-driven card sizing and restrained deletion treatment; `ActualTimelineEditor.css` owns the statistic tiles, timeline legend and container-responsive layout. `Icon.tsx` supplies lightweight decorative SVGs. These presentation files need role-level understanding; no model/service/repository or timing calculation changed. `tests/details-edit.cjs` checks card structure; `tests/windows-details-visual.cjs` checks Edit placement/spacing, statistics, narrow layout and menu containment in an isolated profile. Existing Actual gesture and inline autosave tests remain applicable.

Ctrl timetable editing: `src/useOccurrenceResize.ts` owns edge pointer capture, the 150ms hold, five-minute preview, cancellation and one save on release. `WeekSchedule.tsx` displays the preview without changing overlap ordering. `shared/scheduling/occurrenceResize.ts` maps lifecycle/edge to a field and rejects inverted ranges; understand this mapping and `taskService.resizeOccurrence` deeply. Planned edits change planned start/end; running edits change actual start/planned end; finished edits change actual start/end. Existing occurrence corrections stay within the endpoint's local day, 00:00–23:55; new Task creation keeps its existing future-time validation. The narrow `resizeTaskOccurrence` preload/IPC API checks sender and current lifecycle before saving. A recurring correction atomically excludes its old range and transfers the original occurrence to a standalone Task, including actual history and reminder-slot identity. `taskRepository.detachOccurrenceWithActual` now also transfers the replacement planned range; ordinary Details actual correction still passes the unchanged plan. No schema change.

`TimetableQuickAdd.tsx` uses a two-click state while Ctrl stays held: the first empty-space click fixes start, pointer movement previews a translucent range without holding a mouse button, and a second lower click opens Add Task with both endpoints. A second click in the same snapped slot opens Add Task with only start prefilled and end blank; `TaskForm` requires end before saving, and `taskFormTimes.moveStartTime` preserves that blank until the user chooses an end. Upward/cross-day second clicks are ignored. Right-click, Escape, Ctrl release or blur cancel the pending selection. `quickAddSelection` snaps/clamps the end to planning hours with at least five minutes. Primitive planning-hour dependencies keep a selection alive across ordinary background refreshes. Ctrl mode has no soft-focus overlay. Its five-minute pointer clock guide is independent of empty-space/selection/resize hit testing and stays above cards while Ctrl is held; window pointer capture-phase tracking also keeps it updated during drags. Its exact label is “Ctrl mode active. See the instructions in the top-right corner.”

`useOccurrenceResize` also supports a right-button chord while the left button stays held: pointer buttons/context-menu listeners cancel preview and prevent the eventual left release from saving. This handles Chromium suppressing compatibility mousedown during pointer capture. Keyboard events own Ctrl release; synthetic layout pointer events with missing modifiers cannot accidentally exit the mode. Tests: `occurrence-resize.cjs` (mapping, validation, history transfer/reopen), `quick-add.cjs` / `task-form-times.cjs` (selection math/blank end), and isolated `windows-timetable-resize.cjs`, `windows-quick-add-selection.cjs`, `windows-quick-add.cjs` (stateful selection, both cancellation gestures, single opening, required end and lifecycle protection). Understand gesture ownership/cleanup deeply; CSS grips, rectangle and mode label only need role-level familiarity.

Ctrl drag clock alignment: `timetableViewport.pointerClockMinute` is the shared five-minute pointer clock used by both the persistent horizontal guide and `useOccurrenceResize`. Resizing takes the absolute pointer clock rather than adding a delta to the original endpoint, so grabbing different parts of the handle cannot shift the saved time away from the guide. Invalid/inverted candidates show an error and cannot persist on release; no silent endpoint clamping to a different displayed clock. Holding without moving still preserves precise existing actual timestamps. The existing lifecycle field mapping and cancellation paths are unchanged.

The Task Details History/backfill disclosure is temporarily removed from the modal. TaskHistory, history storage and semantic APIs remain available for future restoration; the always-available Actual timeline/selectors are unchanged. Only its unused local open/busy state and import were removed from TaskDetails. Thirty-minute timetable guide lines use a lighter translucent stroke; two-hour major lines are unchanged.

### Recurring series editing
A recurring series row in Task Center opens the shared TaskForm in an Edit recurring task modal. It edits the parent Task definition through updateTask, with Save Task and Cancel returning to the list. Rule clock times are used for prefill; no first-occurrence Actual information is shown here. Timetable cards still open occurrence-specific Task Details. Existing historical occurrence timestamps are preserved by the service.


### Ctrl-mode guidance
Task Center now sits beside Planning hours and Add Task in the top toolbar, with equal-height action buttons. `src/components/CtrlModeHelp.tsx` provides hover/focus/click guidance through the round question-mark control at the far right. App owns its placement; index.css owns button sizing and the lightweight help panel. Understand its role; it has no service or database dependency. TimetableQuickAdd keeps the bottom mode label and a non-interactive pointer hint visible during Ctrl mode; the hint distinguishes empty-space creation, end-time selection, task edges and active resizing. Scheduling and persistence rules are unchanged.


## Missed workflow

See [Missed workflow](missed-workflow.md). `shared/occurrenceLifecycle.ts` derives Missed from the current clock and planned end, retaining actual/legacy completion precedence. Understand this helper and `taskService.lateStartOccurrence` deeply: it copies metadata into a fresh one-time attempt without touching the original. `taskRepository.createStartedTask` atomically inserts that Task and its running occurrence; `findMissedOccurrences` performs only the DB query. Narrow task IPC/preload methods expose the operations. `src/components/TaskCenter.tsx` loads the unified list and exposes the recent-first Missed filter; TaskDetails owns the explicit today-only action; App inserts/follows the new task and refreshes. WeekSchedule presents the subdued-red card with details-only interaction. Those UI integration points need role-level understanding. Reminder service gates both candidates and queued delivery at planned end. Planning settings no longer reject tasks outside display hours; TaskForm and quick-create offer full-day planned input. No schema, migration or source-link fields were added. Tests: `missed.cjs`, `windows-missed.cjs`, plus updated settings/quick-add/recurrence fixtures.

## Unified Task Center

`App.tsx` has one Task Center toolbar entry replacing the separate recurring and missed entries. `components/TaskCenter.tsx` defaults to no active chips and loads the existing getMissedTasks response (which already includes all Task definitions). `src/taskCenter.ts` merges one-time Tasks, recurring series definitions and independent missed occurrences by ID/range, never title; a missed one-time Task appears once, while each recurring missed occurrence remains separate from its series definition. A single all/recurring/missed filter value guarantees mutual exclusion and same-chip deselection. Recurring rows use Edit recurring task; Missed rows pass the exact occurrence to Details; ordinary one-time rows use normal Details. Series Save/Cancel returns to Task Center. The former MissedTasks component is removed. No service, schema or recurrence change. Read the pure merge/filter helper and destination mapping; presentation only needs role-level familiarity. Tests: task-center.cjs and windows-task-center.cjs, plus updated recurring-editor, missed and toolbar GUI tests.

Task Center search: TaskCenter owns a title search string and stable category-key selection, both defaulting to no restriction. taskCenter.filterTaskCenterEntries combines trimmed, case-insensitive title substring matching and category matching with the exclusive Recurring/Missed chip. Same-title identity and missed ordering are preserved. The category selector reuses shared TASK_CATEGORIES (emoji + label); no database/API changes. Empty search results use a specific no-match message. Tests: task-center.cjs and windows-task-center.cjs.

## Local Profile + Settings

See [Local Profile and Settings](local-profile-settings.md) for the model, file map, delivery policy and migration evidence. Migration 0008 moves preserved Wake/Sleep values to singleton user_settings and adds singleton local_profiles; the old planning_settings table is removed. SettingsPanel replaces PlanningSettings. Profile/settings flow through shared DTOs, narrow preload methods, sender-validated settings IPC, Settings Service and Settings Repository. Window geometry stays in its existing JSON mechanism. App applies section saves immediately; week helpers accept Monday/Sunday starts and new TaskForm creation takes the saved duration. Main reads closeToTray on close; reminder service reads the master switch/resume watermark before delivery. Mini schedule only has a saved preference for now. No Task ownership FK or remote account behavior was added.

Settings now uses one outer form and a single bottom Save button. updateLocalPreferences validates all Profile/Settings inputs before the repository transaction updates both singleton rows atomically. SettingsPanel holds all edits as drafts until Save; App applies the returned preferences and shows one Settings saved toast. Existing preference semantics and schema are unchanged.
