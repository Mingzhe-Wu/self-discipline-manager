# Self Discipline Manager

Local Electron desktop Tasks with planned start/end ranges and editable actual start/end history using React, TypeScript, better-sqlite3, Drizzle, and SQLite.

The main screen shows a scrollable Monday–Sunday timetable covering all 24 hours, with cards positioned by planned start/end and visible overlap handling. Add one-time/daily/weekly Tasks using five-minute Start Time/End Time selects, Start/End an occurrence, or click a card (Enter/Space also work) to open details. Planned ranges stay within one date in their saved time zone. Add/Edit share the same form; history/backfill/correction stays in the secondary details panel. Schedule edits preserve meaningful old ranges and actual history. Local reminder checks run every thirty seconds.

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
