# Reminder MVP

The existing renderer → preload → IPC → service → repository → Drizzle → SQLite architecture is unchanged.

Reminders are standalone: task association, recurrence, and enable/disable controls are deferred. `dueAt` and `createdAt` are Unix milliseconds; the form interprets the selected date/time in the computer's local timezone. Past times are accepted and checked on the next scheduler tick.

Migrations run against `app.getPath("userData")/data.db` before IPC registration and scheduler startup. The scheduler checks immediately at startup and every 60 seconds. Closing the window keeps the scheduler running in the tray. Quitting stops it; overdue reminders are checked on the next launch.

A reminder becomes notified only after Electron emits `show`. Unsupported notifications, synchronous errors, and `failed` events leave it pending for retry. In-flight notifications are retained and skipped on subsequent checks. A crash between showing a notification and recording it can cause a repeat after restart; delivery is not transactional with SQLite.

## Windows notifications

Development uses `app.setAppUserModelId(process.execPath)`. If Windows does not display development notifications, pin `node_modules/electron/dist/electron.exe` to Start. The NSIS build now uses stable AppUserModelID `com.self-discipline-manager.app` and creates Start Menu/Desktop shortcuts. Installed verification observed a real native `show` event; visual toast confirmation is still a manual check. See [Windows build verification](windows-build.md) and [Electron's Windows notification requirements](https://www.electronjs.org/docs/latest/tutorial/notifications#windows).

## Validation

- `npm test`: real SQLite migrations/repository/service and Task regression checks, with simulated Electron notification events and timer control. Runs under Electron's Node runtime to match the native SQLite ABI.
- `npm run build`: renderer and Electron TypeScript checks followed by the production build.
- `npm run lint`: ESLint.

The renderer exposes only list/create/delete reminder APIs. No raw IPC or generic notification test API is exposed. Operational scheduler error logs remain intentionally; setup logs and placeholder scheduler code were removed.
