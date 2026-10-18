# Windows local-test build

Version 0.1.0 is an **unsigned Windows x64 NSIS installer**. The React → preload → IPC → service → repository → Drizzle → SQLite architecture is preserved.

## Build commands

Use Windows x64, Node 24.21.0 or newer and npm 11.19.0 or newer (the versions used for this build are 24.21.0 / 11.19.0). The npm version matters: this project uses npm's `allowScripts` policy. Install from the lockfile:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build:win
```

`npm ci` runs native verification through `postinstall`. `build:win` repeats that verification, type checks, creates electron-vite production output, and runs electron-builder 26.15.3 for NSIS x64. `npm run pack:win` creates only the unpacked application. Packaging uses no other build/installer system. Release output and intermediate build output are gitignored.

## Artifacts and installation

- Installer: `D:\study\self-discipline-manager\release\Self-Discipline-Manager-0.1.0-x64-Setup.exe`
- Packaged application: `D:\study\self-discipline-manager\release\win-unpacked\Self Discipline Manager.exe`
- Verified installed test application: `D:\study\self-discipline-manager\release\installed-test\Self Discipline Manager.exe`
- Verification reports/screenshots: `release/verification/`; latest passing installed report: `release/verification/latest.json`.

Final installer size: **122,325,763 bytes**. SHA-256: `28A59EDDAFCA0394CC3691E717538D38808A0074A4FD53FA851997DB8CCB0E5F` (also recorded beside the installer in `.exe.sha256`). The installed executable and ASAR hashes match the final packaged application.

The installer is assisted NSIS, per-user, supports choosing an installation directory, creates Desktop/Start Menu shortcuts, and does not automatically launch after finishing. The default install is under the user's LocalAppData Programs folder. Verification used `/S /D=D:\study\self-discipline-manager\release\installed-test` and a separate `--user-data-dir` profile, so normal development data was not modified. Uninstallation retains application data.

The application identity is `com.self-discipline-manager.app`; product/executable is **Self Discipline Manager**. The existing tray artwork was converted to `resources/app.ico` for Windows executable/installer metadata. `win.signExecutable: false` disables signing while retaining icon/resource editing. The application and installer are verified `NotSigned`; there is no certificate or signing service. Windows may show an unknown-publisher/SmartScreen warning. Signing is a later public-release step.

Installed Desktop and Start Menu shortcut metadata was inspected: both target the installed test executable and carry AppUserModelID `com.self-discipline-manager.app`. Evidence is in `release/verification/shortcuts.json`.

## Resources and SQLite

`electron-builder.json` includes the complete `out/`, `drizzle/` (SQL and journal/metadata), `resources/tray-icon.png`, the manifest, and required production dependencies. The code and read-only resources live in `resources/app.asar`. The resource paths use `app.getAppPath()`; preload and renderer output layout is preserved. No runtime code depends on the repository or `process.cwd()`.

The writable database is always `path.join(app.getPath("userData"), "data.db")`. Migrations run before handler registration, renderer creation, and scheduling. Database handles are published only after migration success and closed after scheduler shutdown. Migration SQL/journal history is unchanged.

### Native module handling

Electron is pinned to **44.9.0**, better-sqlite3 to **13.0.3**, and the npm lockfile pins the dependency tree. This version of better-sqlite3 uses **Node-API 10**, and ships `prebuilds/win32-x64.node` in the npm package. It does not need an Electron-module-ABI-specific recompilation. This machine's Electron reports modules ABI **149**, Node-API **10**, and native SQLite **3.53.4**.

The standard electron-builder rebuild was attempted and failed because Visual Studio C++ Build Tools are not installed. Investigating the installed package and [upstream v13 release notes](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0) confirmed that the bundled Node-API binary is the intended runtime path. No source recompilation was completed or claimed.

Accordingly, `npmRebuild: false` retains the upstream bundled binary. The npm `allowScripts` policy denies better-sqlite3's unnecessary implicit install rebuild and the unused Squirrel installer helper; it explicitly permits pinned Electron/esbuild setup scripts. Do not use an older npm that ignores this policy. A clean `npm ci` with this policy passed without a C++ compiler.

`npm run verify:native` checks the pinned versions, PE AMD64 machine type, Node-API compatibility, actual prebuild loading, and a real SQLite create/insert/query under Electron. It runs after dependency installation and before packaging. The installed-app check additionally verifies that the loaded `.node` comes from the installed application, not repository node_modules. `asarUnpack` includes the entire better-sqlite3 package; its native files are shipped under `resources/app.asar.unpacked/node_modules/better-sqlite3/`.

If changing Electron, better-sqlite3, architecture, or npm, repeat clean-install, native, and installed-app verification. A future version without a compatible bundled binary needs a documented C++ toolchain/source rebuild rather than bypassing SQLite.

## Startup, lifecycle, and security

- Acquire Electron's single-instance lock before database startup. A second launch exits and shows/restores/focuses the existing window.
- Window close hides to tray. The tray has Open/Quit and double-click restore behavior. Quit stops the scheduler, closes SQLite, and destroys the tray.
- Database/migration/renderer/preload startup errors show a fatal diagnostic, clean up, and exit with failure.
- All seven IPC handlers validate the originating window, top frame, and exact trusted renderer document URL. File origins are not trusted merely because they share `file:`.
- External navigation/redirects and arbitrary new windows are denied. Context isolation stays enabled; Node integration stays disabled; no raw IPC/Node APIs are exposed.
- Production CSP permits local scripts/styles/assets, forbids inline/eval scripts, frames, objects, and form navigation. A development-only electron-vite transform permits React Refresh/Vite inline code/styles and HMR WebSockets. The development renderer was verified separately.
- `sandbox: false` remains necessary for the existing ESM preload. This is an explicit tradeoff, not full Chromium sandbox hardening.

## Automated verification

- `npm run typecheck`, `npm run lint`, `npm test` (9 passing tests), and production/NSIS build.
- Unit/integration regressions: trusted/untrusted IPC senders, startup lock/order, fatal migration/renderer failures, shutdown order, Task/Reminder operations, migration upgrade/data preservation, scheduler retries and late callback handling.
- Clean dependency install plus automatic native verification, with no Visual Studio compiler.
- ASAR/resource and native-unpacking inspection; installer/executable signing status inspection.
- Silent installation returned exit code 0.
- `npm run test:installed` launches the installed executable using a fresh isolated profile and unrelated cwd. It verifies renderer/preload, all required Task/Reminder operations, native SQLite location, migrations, narrow bridge/Node isolation, production CSP, navigation/popup denial, tray presence, close-to-tray, second-process exit/window restoration, and full-restart persistence.
- The installed test waits for the normal one-minute scheduler and forwards the real native `Notification.show()` call. The observed result was one attempt, one actual Electron `show` event, and no failure events. It does not emit fake native events.
- Development smoke check verified React Refresh-compatible CSP and trusted preload IPC against the Vite renderer.
- `npm audit --omit=dev` reported zero known production advisories. The full tooling audit reported 12 moderate advisories; no forced dependency upgrades were applied.

Re-run installed verification after installing a newly built artifact:

```powershell
npm run test:installed -- "D:\path\to\Self Discipline Manager.exe"
```

Playwright Core 1.62.1 is a development dependency for Electron automation; it downloads no standalone browsers. The test's temporary instrumentation exists only in the test process and forwards real notifications. Test profiles/evidence stay under ignored `release/verification/`.

## Manual checks and remaining release risks

- Visually confirm the Windows toast appears with the expected title, app identity/icon, and reminder text. A native `show` event is useful evidence but is not a visual inspection of Windows notification UI.
- Exercise the visible tray Open/Quit menu, installer wizard, Start Menu/Desktop shortcut launches, and uninstall behavior manually. Automated verification covered tray presence and close/relaunch behavior, not physical clicks on the system tray menu.
- Test on another clean Windows x64 machine. The installed app was tested on this Windows machine; no VM/second-machine test was performed.
- Keep the first build local/unsigned; add signing and update/distribution policy before a public release. No cloud/updater backend is configured.
- Delivery is not exactly once across a crash between native display and SQLite acknowledgement. The one-minute polling and current reminder behavior are unchanged.

## Files changed and dependencies added

- Packaging/install policy: `package.json`, `package-lock.json`, `electron-builder.json`, `.gitignore`, `eslint.config.js`, `resources/app.ico`, `scripts/verify-native.cjs`.
- Startup/security: `electron/main.ts`, `electron/db/database.ts`, `electron/ipc/taskIpc.ts`, `electron/ipc/reminderIpc.ts`, `electron/ipc/validateSender.ts`, `electron.vite.config.ts`, `index.html`.
- Verification: `tests/run.cjs`, `tests/reminders.cjs`, `tests/register-typescript.cjs`, `tests/database.cjs`, `tests/security.cjs`, `tests/lifecycle.cjs`, `tests/windows-installed.cjs`.
- Documentation: `README.md`, `docs/reminders.md`, `docs/packaging-readiness.md`, this file, and `docs/superpowers/plans/2026-10-17-windows-build.md`.
- Direct packages added: development-only `electron-builder@26.15.3` and `playwright-core@1.62.1`. Existing Electron and better-sqlite3 versions were pinned, not replaced.

A focused independent code review found no substantive blocker for local unsigned testing. Disposable dependency-install trees and failed test harness profiles were removed after recording successful evidence. No test-only hooks or notification stubs were added to application code.
