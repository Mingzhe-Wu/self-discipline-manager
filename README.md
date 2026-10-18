# Self Discipline Manager

Local Electron desktop tasks and reminders using React, TypeScript, better-sqlite3, Drizzle, and SQLite.

```powershell
npm ci
npm run dev
```

For the first unsigned Windows x64 installer:

```powershell
npm run build:win
```

Use Node 24.21.0+ and npm 11.19.0+; the npm install-script policy is required for compiler-free use of the pinned bundled SQLite native binary.

Start with the [developer walkthrough](docs/developer-walkthrough.md) for a file-by-file reading map. See [Windows build and verification](docs/windows-build.md), [architecture readiness](docs/packaging-readiness.md), and [reminder behavior](docs/reminders.md).
