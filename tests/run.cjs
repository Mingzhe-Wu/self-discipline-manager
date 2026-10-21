const { spawnSync } = require('node:child_process');
const result = spawnSync(require('electron'), ['--test', 'tests/local-settings.cjs', 'tests/task-center.cjs', 'tests/missed.cjs', 'tests/ctrl-guidance.cjs', 'tests/occurrence-resize.cjs', 'tests/actual-timeline.cjs', 'tests/details-edit.cjs', 'tests/actual-scheduling.cjs', 'tests/window-geometry.cjs', 'tests/toasts.cjs', 'tests/deletion-undo.cjs', 'tests/quick-add.cjs', 'tests/categories.cjs', 'tests/timetable-viewport.cjs', 'tests/planning-settings.cjs', 'tests/occurrence-planning.cjs', 'tests/task-form-times.cjs', 'tests/vite-watch.cjs', 'tests/card-lifecycle.cjs', 'tests/tasks.cjs', 'tests/weekly.cjs', 'tests/occurrence-lifecycle.cjs', 'tests/planned-ranges.cjs', 'tests/timetable-overlap.cjs', 'tests/migration-compatibility.cjs', 'tests/security.cjs', 'tests/database.cjs', 'tests/lifecycle.cjs'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
