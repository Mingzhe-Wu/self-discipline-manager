# Migration 0005 compatibility repair

The real user profile was inspected before any writes. Its migration journal contained 0000 through 0004 (five completed migrations). Migration 0005 was absent, both planned columns were still named scheduled_at, and there were 6 Tasks, 47 occurrences and 17 reminder slots. SQLite integrity was OK. The failed attempt had rolled back.

## Root cause

The SQL did invoke legacy_schedule_end as a SQLite function. The application had registered it, so the observed failure was not a missing-function error: the callback threw while interpreting a retained old-rule occurrence through the current rule. Occurrence 4 retained a 20:00 planned start; its task's edited rule was 18:45, so the callback generated 19:15 and rejected an end before the preserved start. Synthetic fixtures had not covered that combination. The registered-callback design also made SQL unusable without application registration.

## Repair

- 0005 SQL now uses only native SQLite DDL, arithmetic, JSON and date operations. No legacy_* SQL functions are called or registered. Existing planned starts, actual timestamps, IDs, audit fields and reminder slots are retained.
- runtimeMigrations.ts reads Drizzle's SQL files and hashes and keeps its existing journal format/order. An immediate transaction includes pending SQL, explicit typed time-zone conversion, foreign-key validation and journal inserts. A failed conversion rolls the entire attempt back.
- Only unjournalled0005 column operations are schema-aware: already completed renames/additions are skipped, while the conversion and index steps can resume. Already journalled upgrades are not replayed. Released 0000–0004 SQL was not edited.
- SQL supplies a start+30-minute baseline. Explicit TypeScript normalization then applies the saved IANA zone and midnight cap within that same transaction. This is not a SQLite callback or SQL-to-TypeScript function call. Current-rule rows retain consistent DST projection; historical old-rule rows derive their end from their own preserved start rather than borrowing the current clock time.
- No actual startedAt/endedAt values are fabricated or rounded. A standalone SQL test confirms0005 executes without application functions. For saved-zone/midnight conversion and partial-DDL recovery, use the application initializer.

## Evidence

A consistent SQLite backup was made before repair and another immediately before the live launch. Snapshot migration compared every original Task/occurrence field (apart from the planned-column rename and deliberate recurrence JSON conversion) and every reminder-slot field. It preserved 6/47/17 rows, passed integrity/foreign-key checks and reopened idempotently.

Regression coverage: raw SQLite execution, retained old-rule progress, every partial 0005 statement prefix, conversion-failure rollback, fresh databases and the existing DST/history/restart suite. Full suite: 62 passed. TypeScript, ESLint, production build/native verification and fresh unpacked Windows packaging passed. No NSIS rebuild.

The newly built app was then launched against C:/Users/EricWu/AppData/Roaming/self-discipline-manager. It displayed the weekly UI without errors, recorded six migrations, retained 6 Tasks/47 occurrences/17 slots, and preserved all original actual/history/notification records. It was closed cleanly after verification. No user database was deleted or reset.

Local private evidence (ignored by Git): release/verification/migration-repair/snapshot-XkYBSA/. Files include original.db, pre-live.db, inspection.json, copy-verification.json and real-app-verification.json. Keep the database backups private; do not commit them.
