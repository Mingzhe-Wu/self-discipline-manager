const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

for (const configFile of ['electron.vite.config.ts', 'vite.config.ts']) {
    test(`${configFile} excludes packaged/QA trees while source files remain watched`, async () => {
        const vite = await import('vite');
        const loader = configFile.startsWith('electron.') ? await import('electron-vite') : vite;
        const loaded = await loader.loadConfigFromFile({ command: 'serve', mode: 'development' }, path.resolve(configFile));
        const config = configFile.startsWith('electron.') ? loaded.config.renderer : loaded.config;
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdm-vite-watch-'));
        const source = path.join(root, 'src', 'sample.ts');
        const release = path.join(root, 'release');
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.mkdirSync(path.join(release, 'qa', 'GPUCache'), { recursive: true });
        fs.writeFileSync(source, 'export const value = 1;');
        for (const file of ['electron.exe', 'dxcompiler.dll', 'LICENSES.chromium.html', 'qa/GPUCache/data.db-wal']) fs.writeFileSync(path.join(release, file), 'fixture');
        let server;
        try {
            server = await vite.createServer({ configFile: false, root, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: config.server?.watch } });
            const deadline = Date.now() + 5000;
            while (!Object.entries(server.watcher.getWatched()).some(([dir, files]) => path.resolve(dir) === path.dirname(source) && files.includes(path.basename(source)))) {
                assert.ok(Date.now() < deadline, 'source file becomes watched');
                await delay(20);
            }
            const watched = Object.keys(server.watcher.getWatched()).map((dir) => path.resolve(dir));
            assert.ok(!watched.some((dir) => dir === release || dir.startsWith(release + path.sep)), 'release is pruned from the watcher, including binaries and runtime cache');
            const events = [];
            server.watcher.on('all', (_event, file) => events.push(path.resolve(file)));
            fs.writeFileSync(path.join(release, 'qa', 'GPUCache', 'new.db-journal'), 'ignored QA data');
            fs.writeFileSync(source, 'export const value = 200;');
            while (!events.includes(source)) {
                assert.ok(Date.now() < deadline, 'source edit is still detected');
                await delay(20);
            }
            await delay(100);
            assert.ok(!events.some((file) => file.startsWith(release + path.sep)), 'QA writes do not emit watcher events');
        } finally {
            if (server) await server.close();
            assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'sdm-vite-watch-'));
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}
