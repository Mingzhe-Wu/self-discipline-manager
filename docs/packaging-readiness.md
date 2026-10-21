# Architecture and packaging status

The current product is a unified scheduled Task with per-occurrence planned/start/end history. See [Task schedules and history](task-scheduling.md), [developer walkthrough](developer-walkthrough.md), and [Windows build guide](windows-build.md).

The architecture remains React → preload → IPC → service → repository → Drizzle → SQLite. Main composes lifecycle, migrations, Task IPC, and occurrence scheduling. Services validate schedules/actual times; repositories own persistence; the renderer does not access Drizzle or Node.

Preserved foundation: one application instance, isolated preload, ten semantic Task APIs with sender/frame/document validation, restricted navigation/popups, production CSP, tray/close-to-tray, fatal startup handling, userData SQLite, runtime migrations, native SQLite verification, and unsigned Windows NSIS configuration.

The new 0002 migration preserves old task/reminder data while removing the separate Reminder runtime. Occurrences survive downtime, recurring completion never disables the whole task, and planned, actual start/end and first entry timestamps remain distinct. Soft deletion retains historical expectations with a cutoff.

The 0003 migration adds an effective schedule boundary for history-preserving edits. The weekly UI derives a bounded visible range and merges occurrence state; navigating future weeks does not persist them. Pure recurrence helpers now live under shared/scheduling. The Temporal polyfill remains a pinned production dependency; no additional packages or native rebuild policy changes were needed.

Current checks include migration/restart/recurrence/backfill/DST tests, security/lifecycle tests, and packaged Electron UI QA. The existing ESM preload remains unsandboxed with context isolation. Signing, visual toast confirmation, physical tray menus, installer/uninstaller checks on another clean Windows machine, and the previous report's development-tool advisories remain release considerations.

The old 0.1.0 installer/evidence in release describes the earlier foundation. Rebuild an installer from current sources before distributing this model; this refactor verifies the fresh unpacked Windows package. No cloud/backend or reporting feature has been introduced.

Migration 0004 replaces binary completion with nullable actual times and durable per-occurrence reminder slots. Services choose the latest still-relevant slot and persist claims before native delivery. Interrupted ambiguous claims become unknown on startup to avoid duplicate delivery. See [the exact reminder policy](reminders.md), including the final thirty-second polling grace. Duration is derived, never stored.

Migration0005 adds planned start/end ranges and saved task zones, retaining occurrence IDs, actual times and delivery records. Existing ranges receive a thirty-minute default capped before local midnight; recurring rows use the same local-clock conversion as rule projection, including DST. The runtime runner executes native SQLite SQL and explicit typed zone normalization atomically before journal commit; it registers no SQLite callbacks. New or changed input uses same-day five-minute boundaries; legacy ranges may remain unchanged. The timetable is a pure planned-range projection, with shared-boundary grouping, deterministic layering and whole-card keyboard/pointer actions. Scheduler polling is30seconds.

The real-profile0005 compatibility issue was repaired and verified against a backup before a successful launch with the original userData. See [migration compatibility repair](migration-compatibility-repair.md); real-profile row counts remained6/47/17 with actual history and delivery records preserved.
