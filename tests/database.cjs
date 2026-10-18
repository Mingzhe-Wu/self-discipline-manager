const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
require('./register-typescript.cjs');

test('database is unavailable until migrations succeed and can be closed safely', () => {
    const { initializeDatabase, getDatabase, closeDatabase } = require('../electron/db/database.ts');
    assert.throws(() => getDatabase(), /Database has not been initialized/);
    assert.throws(() => initializeDatabase(':memory:', path.join(__dirname, 'missing-migrations')));
    assert.throws(() => getDatabase(), /Database has not been initialized/);
    initializeDatabase(':memory:', path.join(__dirname, '../drizzle'));
    assert.ok(getDatabase().$client.open);
    assert.throws(() => initializeDatabase(':memory:', path.join(__dirname, '../drizzle')), /already initialized/);
    closeDatabase();
    assert.throws(() => getDatabase(), /Database has not been initialized/);
    assert.doesNotThrow(() => closeDatabase());
});
