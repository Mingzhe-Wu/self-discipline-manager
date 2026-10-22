const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
require('./register-typescript.cjs');
const db = require('../electron/db/database.ts');
const service = require('../electron/services/settingsService.ts');
const tasks = require('../electron/services/taskService.ts');
const reminders = require('../electron/services/reminderService.ts');
const T = Date.parse('2026-10-21T12:00Z'); let now;
beforeEach(() => { now = T - 6 * 60000; mock.method(Date, 'now', () => now); db.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { db.closeDatabase(); mock.restoreAll(); });

test('one local profile initializes automatically and display name changes preserve creation time', () => {
    const initial = service.getLocalPreferences();
    assert.equal(initial.profile.id, 1); assert.ok(initial.profile.displayName);
    assert.equal(initial.settings.defaultTaskDurationMinutes, 60);
    assert.equal(initial.settings.weekStartsOn, 1);
    now += 1000;
    const saved = service.updateProfile({ displayName: '  Eric  ' });
    assert.equal(saved.displayName, 'Eric'); assert.equal(saved.createdAt, initial.profile.createdAt); assert.equal(saved.updatedAt, now);
    assert.throws(() => service.updateProfile({ displayName: ' ' }));
    assert.equal(service.getLocalPreferences().profile.displayName, 'Eric');
});

test('unified save validates all fields before writing profile or settings', () => {
    const before = service.getLocalPreferences();
    assert.throws(() => service.updateLocalPreferences({ displayName: 'New name', settings: { ...before.settings, defaultTaskDurationMinutes: 3 } }));
    assert.deepEqual(service.getLocalPreferences(), before);
    const saved = service.updateLocalPreferences({ displayName: 'New name', settings: { ...before.settings, defaultTaskDurationMinutes: 90 } });
    assert.equal(saved.profile.displayName, 'New name'); assert.equal(saved.settings.defaultTaskDurationMinutes, 90);
});

test('settings accept independent validated patches and retain unrelated preferences', () => {
    service.updateUserSettings({ wakeTime: '08:00', sleepTime: '23:00', weekStartsOn: 0, defaultTaskDurationMinutes: 90 });
    const value = service.updateUserSettings({ trayMiniEnabled: true, closeToTray: false });
    assert.equal(value.weekStartsOn, 0); assert.equal(value.defaultTaskDurationMinutes, 90);
    assert.equal(value.trayMiniEnabled, true); assert.equal(value.closeToTray, false);
    for (const input of [{ weekStartsOn: 2 }, { defaultTaskDurationMinutes: 3 }, { notificationsEnabled: 'false' }, { trayMiniEnabled: 1 }, { unknown: true }, { wakeTime: '23:00', sleepTime: '08:00' }]) assert.throws(() => service.updateUserSettings(input));
    assert.deepEqual(service.getLocalPreferences().settings, value);
});

test('notification master switch preserves slots and does not replay the slot that elapsed while disabled', () => {
    const task = tasks.createTask({ title: 'Notify', scheduleType: 'one-time', enabled: true, scheduledStartAt: T, scheduledEndAt: T + 3600000, timeZone: 'UTC' });
    now = T - 5 * 60000;
    const pre = reminders.getDueReminders()[0]; assert.ok(reminders.claimReminder(pre)); reminders.markReminderSent(pre);
    service.updateUserSettings({ notificationsEnabled: false }); now = T;
    assert.deepEqual(reminders.getDueReminders(), []);
    now = T + 60000; service.updateUserSettings({ notificationsEnabled: true });
    assert.deepEqual(reminders.getDueReminders(), []);
    now = T + 3 * 60000; assert.equal(reminders.getDueReminders()[0].slot, 3);
    assert.equal(tasks.getAllTasks()[0].enabled, true);
    assert.equal(db.getDatabase().$client.prepare('SELECT state FROM occurrence_reminder_slots WHERE occurrence_id=?').get(task.currentOccurrence.id).state, 'sent');
});

test('profile/settings persist across database reopen without duplicate singleton rows', () => {
    db.closeDatabase(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preferences-'));
    try {
        const file = path.join(dir, 'data.db'); db.initializeDatabase(file, path.resolve('drizzle'));
        service.updateProfile({ displayName: 'Local person' });
        service.updateUserSettings({ trayMiniEnabled: true, defaultTaskDurationMinutes: 45, weekStartsOn: 0, notificationsEnabled: false });
        now = T + 60000; service.updateUserSettings({ notificationsEnabled: true });
        const before = service.getLocalPreferences(); db.closeDatabase(); db.initializeDatabase(file, path.resolve('drizzle'));
        assert.deepEqual(service.getLocalPreferences(), before);
        assert.equal(service.notificationsAllowedForSlot(T), false);
        assert.equal(service.notificationsAllowedForSlot(T + 180000), true);
        const sql = db.getDatabase().$client;
        assert.equal(sql.prepare('SELECT count(*) n FROM local_profiles').get().n, 1);
        assert.equal(sql.prepare('SELECT count(*) n FROM user_settings').get().n, 1);
    } finally { db.closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('week start and configured duration change only projection and new-form defaults', () => {
    const { weekRange, weekDays } = require('../shared/scheduling/week.ts');
    const { defaultEndTime } = require('../src/taskFormTimes.ts');
    const monday = weekRange(T, 'UTC', 1), sunday = weekRange(T, 'UTC', 0);
    assert.equal(weekDays(monday.from, 'UTC')[0].date, '2026-10-19');
    assert.equal(weekDays(sunday.from, 'UTC')[0].date, '2026-10-18');
    assert.equal(defaultEndTime('09:00', 90), '10:30');
    const { quickAddDraft } = require('../src/timetableQuickAdd.ts');
    assert.equal(quickAddDraft('2026-10-22', 540, 1, 0, { wakeTime: '08:00', sleepTime: '10:00' }, 90).endTime, '10:30');
    const { renderToStaticMarkup } = require('react-dom/server'), React = require('react');
    const Form = require('../src/components/TaskForm.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Form, { initialPlan: { date: '2026-10-22', startTime: '09:00' }, defaultDurationMinutes: 90, onSave: async () => {}, onCancel() {} }));
    assert.match(html.match(/<select aria-label="End Time hour"[\s\S]*?<\/select>/)[0], /value="10" selected=""/);
    assert.match(html.match(/<select aria-label="End Time minute"[\s\S]*?<\/select>/)[0], /value="30" selected=""/);
});

test('task settings changes do not rewrite existing plans and notification resume admits future slots', () => {
    const task = tasks.createTask({ title: 'Keep plan', scheduleType: 'one-time', enabled: true, scheduledStartAt: T, scheduledEndAt: T + 3600000, timeZone: 'UTC' });
    const before = db.getDatabase().$client.prepare('SELECT * FROM tasks').all();
    service.updateUserSettings({ weekStartsOn: 0, defaultTaskDurationMinutes: 120, wakeTime: '15:00', sleepTime: '16:00' });
    assert.deepEqual(db.getDatabase().$client.prepare('SELECT * FROM tasks').all(), before);
    service.updateUserSettings({ notificationsEnabled: false }); now = T + 60000;
    service.updateUserSettings({ notificationsEnabled: true });
    assert.equal(service.notificationsAllowedForSlot(T), false);
    assert.equal(service.notificationsAllowedForSlot(T + 180000), true);
    assert.equal(task.currentOccurrence.startedAt, null);
});

test('0008 consolidates old Wake/Sleep without touching tasks, actual history, slots or exclusions', () => {
    db.closeDatabase(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-migration-'));
    try {
        const old = path.join(dir, 'old'); fs.mkdirSync(path.join(old, 'meta'), { recursive: true });
        const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json')); journal.entries = journal.entries.slice(0, 8);
        fs.writeFileSync(path.join(old, 'meta/_journal.json'), JSON.stringify(journal));
        for (const entry of journal.entries) fs.copyFileSync(path.join('drizzle', entry.tag + '.sql'), path.join(old, entry.tag + '.sql'));
        const file = path.join(dir, 'data.db'); db.initializeDatabase(file, old);
        let sql = db.getDatabase().$client;
        sql.exec("INSERT INTO planning_settings VALUES(1,'07:30','22:45')");
        sql.prepare("INSERT INTO tasks(id,title,category,schedule_type,scheduled_start_at,scheduled_end_at,time_zone,created_at,updated_at) VALUES(1,'Existing','work','one-time',?,?,'UTC',123,456)").run(T, T + 3600000);
        sql.prepare("INSERT INTO task_occurrences(id,task_id,scheduled_start_at,scheduled_end_at,started_at,ended_at,recorded_at,progress_source,created_at,updated_at) VALUES(1,1,?,?,?,?,?,'corrected',123,456)").run(T, T + 3600000, T + 12345, T + 3456789, T + 7654);
        sql.exec("INSERT INTO occurrence_reminder_slots(occurrence_id,slot,state,sent_at) VALUES(1,0,'sent',42)");
        sql.prepare('INSERT INTO recurrence_exclusions(task_id,scheduled_start_at,scheduled_end_at,created_at) VALUES(1,?,?,123)').run(T, T + 3600000);
        const tables = ['tasks', 'task_occurrences', 'occurrence_reminder_slots', 'recurrence_exclusions'];
        const before = tables.map(table => sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
        db.closeDatabase(); db.initializeDatabase(file, path.resolve('drizzle')); sql = db.getDatabase().$client;
        assert.deepEqual(service.getPlanningHours(), { wakeTime: '07:30', sleepTime: '22:45' });
        assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='planning_settings'").get().n, 0);
        for (const [index, table] of tables.entries()) assert.deepEqual(sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all(), before[index]);
        assert.deepEqual(sql.pragma('foreign_key_check'), []);
        assert.equal(sql.pragma('integrity_check', { simple: true }), 'ok');
    } finally { db.closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }); }
});
