# Developer walkthrough

Use this as a reading checklist, not an API manual. Paths are relative to the project root. **Deep** means you should be able to explain the control flow and change it; **Role** means know its inputs, outputs, and when to consult it. No Git history exists yet, so this maps the current foundation rather than claiming a historical diff.

## Start with one request

Read `src/App.tsx` → `electron/preload.ts` → `electron/ipc/taskIpc.ts` → `electron/services/taskService.ts` → `electron/db/taskRepository.ts` → `electron/db/schema.ts`. Creating a task follows that path to SQLite; the result returns as a Promise and React updates its state. Only repositories issue application queries. Shared types describe the crossing data; they do not validate runtime input.

Then read `electron/main.ts` → `electron/db/database.ts` → `electron/scheduler/reminderScheduler.ts` for startup and background work. Finish with `electron-builder.json` and `docs/windows-build.md` for installation.

## Electron lifecycle and bridge

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `electron/main.ts` | Main-process entry point: single-instance lock, window/tray, startup failure handling, shutdown. | Electron runs its built output via `package.json`; it calls database, IPC registration, sender validator, scheduler. | Internal `createWindow`, `showMainWindow`, `createTray`, `cleanup`, `reportFatalError`; app event handlers. No exports. | Deep |
| `electron/preload.ts` | Isolated bridge between React and Electron IPC. Exposes seven semantic methods, no raw Node/IPC access. | Loaded by `main.ts` into the window; React calls `window.electronAPI`; invokes handlers in `electron/ipc/`. | `contextBridge.exposeInMainWorld("electronAPI", …)` with Task list/create/update/delete and Reminder list/create/delete. | Deep |
| `src/electron.d.ts` | Renderer type declaration for that bridge; does not implement it. | TypeScript checks React callers using shared Task/Reminder types. Keep signatures aligned with preload. | Augments `Window.electronAPI`, returning typed Promises. | Deep |
| `index.html` | Renderer HTML entry and production Content Security Policy. | electron-vite builds it; main loads the built page; it loads `src/main.tsx`. | `#root`, module script, CSP meta tag. | Role |

Startup order: acquire lock → app ready → migrate userData database → register handlers → load window/preload → create tray → start scheduler. Quit stops scheduling before closing SQLite. Closing the window only hides it. `contextIsolation: true`, `nodeIntegration: false`; `sandbox: false` supports the existing ESM preload.

## IPC, services, and repositories

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `electron/ipc/validateSender.ts` | IPC security boundary: require the intended window, top frame, and trusted document URL. | `main.ts` creates a validator; both IPC modules call it before services. | `createSenderValidator`, `SenderValidator`. | Deep |
| `electron/ipc/taskIpc.ts` | Task request/response wiring; service errors reject `invoke`. | Registered once by main; receives preload `task:*` requests; calls `taskService`. | `registerTaskIpc(validateSender)`. | Deep |
| `electron/ipc/reminderIpc.ts` | Reminder request/response wiring. | Registered by main; receives preload `reminder:*`; calls `reminderService`. | `registerReminderIpc(validateSender)`. | Deep |
| `electron/services/taskService.ts` | Task business rules: trim titles, reject empty/non-string titles, invalid IDs, and non-boolean completion. | Task IPC calls it; delegates persistence to `taskRepository`. | `getAllTasks`, `createTask`, `updateTaskCompleted`, `deleteTask`; internal `validateTaskId`. | Deep |
| `electron/services/reminderService.ts` | Reminder validation/normalization and creation time; accepts past due times. | Reminder IPC and scheduler call it; delegates to `reminderRepository`. | `getAllReminders`, `createReminder`, `deleteReminder`, `getDueReminders`, `markReminderAsNotified`. | Deep |
| `electron/db/taskRepository.ts` | Task persistence only: Drizzle select/insert/update/delete. | Called by Task service; uses `getDatabase()` and `tasksTable`. | `getAllTasks`, `createTask`, `updateTaskCompleted`, `deleteTask`. | Deep |
| `electron/db/reminderRepository.ts` | Reminder persistence, due filtering, and notified flag. | Called by Reminder service; uses `getDatabase()` and `remindersTable`. | `getAllReminders`, `createReminder`, `deleteReminder`, `findDueReminders`, `markReminderAsNotified`. | Deep |

Service/repository functions sometimes share names: imports alias them or use `repository.*` to make the boundary clear. IPC does not query SQLite, and services do not show Electron notifications.

## Database, migrations, and scheduling

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `electron/db/schema.ts` | Drizzle database model: Task and standalone Reminder tables. | Repositories import tables; Drizzle Kit reads it to generate migrations. | `tasksTable`, `remindersTable`; inferred DB types `Task`, `Reminder`. | Deep |
| `electron/db/database.ts` | Owns the native connection and migration lifecycle; publishes DB only after successful migrations. | Main initializes/closes it; repositories obtain its Drizzle handle; tests use isolated databases. | `initializeDatabase`, `getDatabase`, `closeDatabase`. | Deep |
| `drizzle.config.ts` | Development migration-generation configuration, not installed startup configuration. | Drizzle Kit reads schema and writes `drizzle/`; `dev.db` is a development target only. | Default `defineConfig` export. | Role |
| `drizzle/0000_simple_jean_grey.sql` | First persisted schema change. | Runtime migrator applies it according to the journal. | SQL creating `tasks`; no TS exports. | Role |
| `drizzle/0001_sweet_frightful_four.sql` | Reminder schema change. | Runtime migrator applies it after 0000. | SQL creating `reminders`. | Role |
| `drizzle/meta/_journal.json` | Ordered migration tags/timestamps. Required at runtime alongside SQL. | Drizzle generation updates it; runtime migrator reads it. | `entries` migration history. | Role |
| `drizzle/meta/0000_snapshot.json` | Generated Task-only schema snapshot. | Drizzle Kit uses generation metadata; not queried by application code. | Schema JSON, no functions. | Role |
| `drizzle/meta/0001_snapshot.json` | Generated Task+Reminder schema snapshot. | Drizzle Kit uses it when generating the next diff. | Schema JSON, no functions. | Role |
| `electron/scheduler/reminderScheduler.ts` | Main-process background notifications; startup check plus 60-second polling. | Main starts/stops it; it calls Reminder service and Electron `Notification`. | `startReminderScheduler`, `stopReminderScheduler`; internal `checkReminders`, timer, pending map. | Deep |

The live DB is `app.getPath("userData")/data.db`, outside installed resources. Reminder times are Unix milliseconds; booleans are SQLite integer boolean mode. The scheduler selects overdue, unnotified rows, skips pending attempts, and marks notified after the native `show` event. A crash between display and DB acknowledgement can still cause a repeat. Commit migration SQL, journal, and snapshots even though they are generated; do not edit released migration history to change a deployed schema.

## Shared contracts and React

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `shared/types/task.ts` | Cross-process Task data contract, independent of Drizzle. | Renderer, bridge declarations, Task service. | `Task` interface. | Deep |
| `shared/types/reminder.ts` | Cross-process Reminder and creation contracts. | Renderer, preload/declarations, IPC, Reminder service. | `Reminder`, `CreateReminderInput`. | Deep |
| `src/main.tsx` | React bootstrap. | Loaded by HTML; mounts `App`, imports `index.css`. | `createRoot(...).render(...)` with StrictMode. | Role |
| `src/App.tsx` | Root UI and Task state/loading/errors; includes Reminder UI. | React bootstrap renders it; it calls bridge methods and Task components. | Default `App`; create/toggle/delete handlers, initial load effect, error helper. | Deep |
| `src/components/TaskForm.tsx` | Task title input; sends a create callback to App. | App renders it and supplies `onCreate`; no direct IPC. | Default `TaskForm`, internal `handleSubmit`. | Deep |
| `src/components/TaskList.tsx` | Maps Task data to rows and forwards callbacks. | App renders it; renders `TaskItem`. | Default `TaskList`. | Role |
| `src/components/TaskItem.tsx` | One Task checkbox/title/delete button. | TaskList renders it; callbacks lead back to App. | Default `TaskItem`; props callbacks. | Role |
| `src/components/Reminders.tsx` | Reminder form/list, local-time conversion, busy/error/loading state, delete, status refresh. | App renders it; calls Reminder bridge methods; uses shared types. | Default `Reminders`; `createReminder`, `deleteReminder`, refresh effect, request-version ref. | Deep |
| `src/index.css` | Currently loaded global appearance. | Imported by `src/main.tsx`. | CSS rules, no exports. | Role |

The Reminder refresh effect runs every minute and on window focus; it only refreshes the list. The actual notification scheduler is in Electron. Request versions keep an older list response from overwriting newer mutations. Loading/error/empty states are UI concerns, not database rules.

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
| `.gitignore` | Local/generated-file exclusion policy. Does not delete files or determine builder contents. | Git will use it after repository initialization; builder has its own `files` rules. | Ignore patterns, no exports. | Role |

Native detail to remember: better-sqlite3 **13.0.3** ships a Windows x64 **Node-API 10** binary. `npmRebuild: false` and the npm install-script policy avoid an unnecessary compiler rebuild. Actual loading is verified under pinned Electron and again after installation. Read `docs/windows-build.md` before changing these versions or npm policy; ordinary application changes do not require understanding the binary-check implementation.

Resources: `resources/tray-icon.png` is loaded by main; `resources/app.ico` is the Windows packaging icon. Commit both. `public/favicon.svg` is referenced by HTML and copied to the renderer output. `src/App.css`, `src/assets/{react.svg,vite.svg,hero.png}`, and `public/icons.svg` are currently unused starter/template assets; understand their role only. This walkthrough does not remove them or change styling.

## Tests and documentation

| File | Responsibility / layer | Callers and dependencies | Main functions / exports | Read |
| --- | --- | --- | --- | --- |
| `tests/run.cjs` | Fast test entry: launches tests under Electron's Node runtime. | `npm test`; runs the four test modules below. | `spawnSync`, exit propagation. | Role |
| `tests/register-typescript.cjs` | Test-only TypeScript-to-CommonJS loader. | Imported by DB/Reminder/security tests; uses TypeScript. | Registers `require.extensions['.ts']`. | Role |
| `tests/reminders.cjs` | Real SQLite/Task/Reminder validation and persistence, migration upgrades, scheduler retries/duplicates/late events. | Test runner; uses services/repos and test-only notification/timer doubles. | Two `node:test` tests. | Deep |
| `tests/database.cjs` | Initialization failure, availability, double-init guard, safe close. | Test runner; calls database lifecycle with isolated DB. | One test. | Role |
| `tests/security.cjs` | Trusted main frame/window/URL checks; rejects other ports/paths/frames. | Test runner; exercises `createSenderValidator`. | Two tests. | Deep |
| `tests/lifecycle.cjs` | Startup ordering/lock, navigation denial, restoration, fatal cleanup. | Test runner; transpiles main into a VM with Electron test doubles. | Internal `boot` harness; four tests. | Role |
| `tests/windows-installed.cjs` | Actual installed-app verification, fresh userData, CRUD/restart, tray/relaunch, real minute scheduler. | `test:installed`; Playwright Core launches an installed executable. | `main`, `waitFor`; writes ignored reports/screenshots. | Role |
| `README.md` | Starting point for developer/build commands. | Human readers; links build/readiness/reminder docs. | No code exports. | Role |
| `docs/reminders.md` | Reminder semantics, retry/time choices, Windows notification context. | Reference when changing reminder behavior; links build docs. | No code exports. | Role |
| `docs/packaging-readiness.md` | Current architecture/readiness summary and resolved review findings. | Reference for architecture discussions; links current build guide. | No code exports. | Role |
| `docs/windows-build.md` | Reproduction commands, native policy, artifact paths, verification, signing/manual limits. | Developers preparing/testing installers. | No code exports. | Deep before packaging |
| `docs/superpowers/plans/2026-10-17-windows-build.md` | Completed implementation plan and decision record. | Historical reference; not an input to npm/runtime. | Checklists/completion evidence, no exports. | Role |
| `docs/developer-walkthrough.md` | This reading map. | README/human readers; points to code above. | No code exports. | Role |

Fast tests use controlled native-notification events; installed tests forward real notification calls. A `show` event is not visual confirmation of Windows toast appearance. Temporary instrumentation belongs in tests, not in the packaged application.

## What to commit versus regenerate

Commit source, tests, configs, docs, resource artwork, `package.json`, `package-lock.json`, and the complete `drizzle/` history. Regenerate `node_modules/` with `npm ci`, `out/` with `npm run build`, and `release/` with `npm run build:win`. Release contents include installers, unpacked/installed copies, local SQLite test profiles, QA evidence, and builder logs; none belong in the initial source commit. `data.db` in real Electron userData is personal runtime data, not project source.

When reading tomorrow, ask: can I trace one successful request and one rejected request, explain the startup/quit sequence, distinguish UI refreshing from notification scheduling, and explain why migrations are committed but the database is not? Mark unclear files and discuss those before changing architecture.
