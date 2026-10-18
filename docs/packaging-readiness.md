# Architecture and packaging status

Updated after producing the first Windows x64 NSIS build. The original readiness findings have been addressed for local unsigned testing. See [Windows build instructions and verification](windows-build.md) for current commands, artifact paths, native handling, evidence, and manual checks.

The architecture remains React → preload → IPC → service → repository → Drizzle → SQLite. `main.ts` composes application lifecycle, window/tray setup, migrations, IPC, and scheduling. Repositories own database access; services own validation; IPC and renderer do not access Drizzle directly.

## Resolved readiness findings

- Migration and tray resource paths use `app.getAppPath()`; the packager includes them in the installed ASAR. Preload/renderer output layout and external production dependencies are preserved.
- A single-instance lock precedes SQLite/scheduler startup; a second launch restores/focuses the existing window.
- Every semantic IPC method validates the main window, top-level frame, and trusted document. Navigation/new windows are restricted, production CSP is present, context isolation is enabled, and Node integration is disabled.
- Migrations complete before consumers start. Fatal initialization/load failures report an error, clean up, and exit. SQLite has an explicit close lifecycle.
- Native SQLite is pinned and verified using better-sqlite3 13's bundled Windows x64 Node-API binary. No local source rebuild was completed; the compiler-free clean-install path and installed binary loading are verified and documented.
- An unsigned, per-user NSIS installer and unpacked application are generated under ignored `release/`. Installed-app tests cover CRUD, restart persistence, migrations, native loading, tray hiding/restoration, single-instance behavior, and real minute polling.

## Preserved decisions and limitations

The seven preload methods remain narrow; raw IPC/Node access is not exposed. Task/Reminder handlers register once after migrations. Reminder polls remain one minute plus startup, with per-process timer/pending guards and database acknowledgement only after Electron's `show` event. Notification/database acknowledgement is not transactional across a crash.

The existing ESM preload remains unsandboxed with context isolation. Signing, visual toast inspection, physical tray menu interaction, wizard/shortcut/uninstall checks, and testing on a second clean Windows machine remain later/manual work. These limits are listed in the current build documentation rather than being treated as verified.
