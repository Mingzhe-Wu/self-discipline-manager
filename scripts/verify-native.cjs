const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.argv.includes('--electron-child')) {
    const manifest = require('../package.json');
    assert.equal(process.platform, 'win32', 'This build targets Windows');
    assert.equal(process.arch, 'x64', 'This build targets Windows x64');
    assert.equal(process.versions.electron, manifest.devDependencies.electron);
    assert.equal(require('better-sqlite3/package.json').version, manifest.dependencies['better-sqlite3']);
    assert.ok(Number(process.versions.napi) >= 10, 'better-sqlite3 13 requires Node-API 10');
    const binary = path.join(path.dirname(require.resolve('better-sqlite3/package.json')), 'prebuilds/win32-x64.node');
    const bytes = fs.readFileSync(binary);
    const peOffset = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.toString('ascii', peOffset, peOffset + 4), 'PE\0\0');
    assert.equal(bytes.readUInt16LE(peOffset + 4), 0x8664, 'Native binary must be AMD64');
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    try {
        db.exec('CREATE TABLE native_check (value TEXT NOT NULL)');
        db.prepare('INSERT INTO native_check VALUES (?)').run('native SQLite works');
        assert.equal(db.prepare('SELECT value FROM native_check').get().value, 'native SQLite works');
        assert.ok(require.cache[binary], 'The bundled Windows x64 prebuild must be loaded');
        console.log(`Native verification passed: Electron ${process.versions.electron}, modules ABI ${process.versions.modules}, Node-API ${process.versions.napi}, Windows x64, SQLite ${db.prepare('SELECT sqlite_version() AS version').get().version}`);
    } finally {
        db.close();
    }
} else {
    const result = spawnSync(require('electron'), [__filename, '--electron-child'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
}
