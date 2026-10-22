# Self Discipline Manager

Local Electron desktop Tasks with planned start/end ranges and editable actual start/end history using React, TypeScript, better-sqlite3, Drizzle, and SQLite.

The main screen shows a scrollable Monday–Sunday timetable with planned/actual display geometry and deterministic overlap handling. Add one-time/daily/weekly Tasks using separate Hour/Minute controls in five-minute steps. On expanded cards, the upper information area opens Details and the lower area performs Start/Finish/confirmed Reset; keyboard controls are also available. Planned ranges stay within one date in their saved time zone. Add/Edit share the same form; Actual-time correction stays in the secondary details panel; stored history is preserved even while its disclosure is hidden. Schedule edits preserve meaningful old ranges and actual history. Local reminder checks run every thirty seconds.

```powershell
npm ci
npm run dev
```

For the first unsigned Windows x64 installer:

```powershell
npm run build:win
```

Use Node 24.21.0+ and npm 11.19.0+; the npm install-script policy is required for compiler-free use of the pinned bundled SQLite native binary.

Start with the [developer walkthrough](docs/developer-walkthrough.md) for a file-by-file reading map. See [Task schedules and occurrence history](docs/task-scheduling.md), [Windows build and verification](docs/windows-build.md), and [architecture readiness](docs/packaging-readiness.md).

For the repaired legacy-database upgrade and preservation checks, see [migration compatibility repair](docs/migration-compatibility-repair.md).

The optional [floating Today view](docs/desktop-mini-view.md) supports hover-to-peek, click-to-pin, docking, fullscreen suppression, Now & Next and a single-day timetable. Its state and Task data stay local.
