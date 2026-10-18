# First Windows Installer Implementation Plan

**Goal:** Produce and verify an unsigned Windows x64 NSIS installer using electron-builder.

**Architecture:** Preserve React → preload → IPC → service → repository → Drizzle → SQLite. Keep migrations and tray resources at application-root-relative paths, pack production code in ASAR, and unpack native SQLite files. Run checks against an installed copy with isolated userData.

**Spec:** User's attached Windows build request, 2026-10-17.

**Constraints:** No product features, backend, architecture replacement, or signing configuration. Stable app ID `com.self-discipline-manager.app`; executable `Self Discipline Manager.exe`; installer version `0.1.0`; Windows x64 only. One-minute reminder polling.

## Tasks

- [x] Add security regression tests for IPC top-frame/window/URL checks; implement a small sender validator, deny unintended navigation/windows, and add a CSP compatible with production and Vite development.
- [x] Add lifecycle regression tests; acquire the single-instance lock before startup, focus the existing window on relaunch, handle startup/load failures, and close SQLite after stopping the scheduler. No consumers receive a database until migrations succeed.
- [x] Add pinned electron-builder, unsigned NSIS configuration, resource/dependency inclusion, native rebuild scripts, and generated-output ignores. Reuse the existing PNG for a Windows icon if supported.
- [x] Run TypeScript, ESLint, all tests, production build, and Windows packaging. Inspect ASAR contents and native unpacking.
- [x] Install silently into an isolated test location and test the installed executable: renderer/preload/CRUD, full-restart persistence, migrations, tray/close behavior, second-instance focus, and scheduler/native SQLite execution. Do not equate a mocked notification event with a real Windows toast.
- [x] Update packaging documentation with exact commands/artifacts, native handling, signing status, verification evidence, and manual checks. Obtain a final focused code review and address substantive findings.

## Review focus

- Reject a different webContents, child frame, or file URL even though file origins are opaque.
- A second launch must not initialize a second database/scheduler.
- Startup failures must quit without leaving a hidden broken app.
- Installed code must not resolve dependencies/resources from the source repository.
- Existing SQLite data must survive restarts and schema migration.

## Execution notes

Implement inline. There is no Git repository in the supplied workspace; Git-based worktrees/commits are unavailable. Preserve useful tests and diagnostics. Completion evidence will be recorded in packaging documentation.


## Completion evidence

All tasks complete. Nine tests, lint, type checks, production build, NSIS packaging, clean npm ci, development smoke, ASAR inspection, and final installed-app verification passed. Current evidence is in release/verification/latest.json. The final installer is unsigned and its hash is recorded alongside it and in docs/windows-build.md.

Ruling: use the pinned better-sqlite3 13.0.3 bundled Windows x64 Node-API 10 prebuild instead of local recompilation. The generic rebuild failed for absent Visual Studio; upstream v13 uses stable Node-API and ships the intended binary. Selective npm script denial plus npmRebuild:false prevents unnecessary compiler calls; native verification and real installed CRUD/migrations prove native loading. On a future incompatible version/architecture this decision must be revisited; the build must fail native verification rather than silently dropping SQLite.

A fresh code reviewer found no substantive blocker for local unsigned use. Remaining manual checks and development-tool advisories are documented. No Git/worktree/commit operations were performed because the workspace is not a Git repository.
