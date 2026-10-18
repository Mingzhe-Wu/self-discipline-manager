const { spawnSync } = require('node:child_process');
const result = spawnSync(require('electron'), ['--test', 'tests/reminders.cjs', 'tests/security.cjs', 'tests/database.cjs', 'tests/lifecycle.cjs'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
