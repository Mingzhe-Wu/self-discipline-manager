import { categoryMetadata, isTaskCategory } from "../../shared/taskCategories";
import { randomUUID } from "node:crypto";
import { TASK_DELETE_UNDO_MS, type TaskDeletionReceipt } from "../../shared/types/task";
import type { OccurrenceTarget, UpdateOccurrenceTimesInput, UpdateOccurrencePlanInput, CreateTaskInput, Task, TaskOccurrence, WeekSchedule } from "../../shared/types/task";
import * as repository from "../db/taskRepository";
import type { TaskRecord } from "../db/schema";
import { firstOccurrenceAt, generateOccurrenceTimes, localDayRange, validateRecurrence, occurrenceEndAt, validatePlannedInstants } from "../../shared/scheduling/recurrence";
import { deriveOccurrences, expectedTimes, isExcluded } from "../../shared/scheduling/week";
import { assertPlanningRange } from "../../shared/scheduling/planningHours";
import { getPlanningHours } from "./settingsService";

import { canLateStart, occurrenceState } from "../../shared/occurrenceLifecycle";
import { occurrenceDisplayRange } from "../../shared/scheduling/occurrenceDisplay";
import { resizeField, resizeOccurrenceRange } from "../../shared/scheduling/occurrenceResize";
import type { ResizeOccurrenceInput } from "../../shared/types/task";
import { Temporal } from "@js-temporal/polyfill";

const DAY = 86400000;

function validateId(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid task/occurrence ID");
}

function validateTime(time: number) {
    if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time).getTime())) throw new Error("Invalid timestamp");
}

function requireTask(id: number): TaskRecord {
    validateId(id);
    const task = repository.getTask(id);
    if (!task) throw new Error("Task was not found");
    return task;
}

function rangesFor(task: Pick<TaskRecord, "scheduleType" | "scheduledEndAt" | "recurrenceRule">, times: number[]) {
    return times.map((scheduledStartAt) => ({ scheduledStartAt, scheduledEndAt: occurrenceEndAt(task, scheduledStartAt) }));
}

function materialize(task: TaskRecord, through: number = Date.now() + 14 * DAY): void {
    if (task.scheduleType === "one-time") {
        if (task.generatedThrough === null) repository.materializeOccurrences(task.id, rangesFor(task, [task.scheduledStartAt]), task.scheduledStartAt, Date.now());
        return;
    }
    if (!task.recurrenceRule) throw new Error("Recurring task is missing its schedule");
    const target = Math.max(through, firstOccurrenceAt(task.recurrenceRule));
    if (task.generatedThrough !== null && task.generatedThrough >= target) return;
    const from = Math.max(task.scheduleEffectiveAt, task.scheduledStartAt, task.generatedThrough === null ? task.scheduledStartAt : task.generatedThrough + 1);
    repository.materializeOccurrences(task.id, rangesFor(task, generateOccurrenceTimes(task.recurrenceRule, from, target)), target, Date.now());
}

function toTask(task: TaskRecord): Task {
    const today = task.recurrenceRule ? localDayRange(Date.now(), task.recurrenceRule.timeZone) : null;
    const todayOccurrence = today ? repository.listOccurrences(task.id, today.from, today.to)[0] : undefined;
    const singleOccurrence = task.scheduleType === "one-time" ? repository.getOccurrenceAt(task.id, task.scheduledStartAt, task.scheduledEndAt) : undefined;
    return {
        id: task.id, title: task.title, category: categoryMetadata(task.category).key, scheduleType: task.scheduleType, scheduledStartAt: task.scheduledStartAt, scheduledEndAt: task.scheduledEndAt, timeZone: task.timeZone,
        recurrenceRule: task.recurrenceRule, enabled: task.enabled, createdAt: task.createdAt, updatedAt: task.updatedAt,
        origin: task.origin,
        scheduleEffectiveAt: task.scheduleEffectiveAt,
        currentOccurrence: task.scheduleType === "one-time" ? singleOccurrence ?? null
            : todayOccurrence ?? repository.getCurrentOccurrence(task.id, Date.now()) ?? null,
        nextOccurrenceAt: task.scheduleType === "one-time"
            ? occurrenceState(singleOccurrence ?? null) !== "completed" && task.scheduledStartAt > Date.now() ? task.scheduledStartAt : null
            : repository.getNextOccurrence(task.id, Date.now())?.scheduledStartAt ?? null,
    };
}

export function getAllTasks(): Task[] {
    return repository.getAllTasks().map((task) => { materialize(task); return toTask(task); });
}

function validateTaskInput(input: CreateTaskInput, existing?: TaskRecord) {
    if (!input || typeof input.title !== "string" || !input.title.trim()) throw new Error("Task title cannot be empty");
    if (input.scheduleType !== "one-time" && input.scheduleType !== "recurring") throw new Error("Invalid schedule type");
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("Enabled must be a boolean");
    if (input.category !== undefined && !isTaskCategory(input.category)) throw new Error("Invalid task category");
    const category = input.category ?? existing?.category ?? "other";
    const unchanged = existing && input.scheduleType === existing.scheduleType && (input.scheduleType === "recurring"
        ? JSON.stringify(input.recurrenceRule) === JSON.stringify(existing.recurrenceRule)
        : input.scheduledStartAt === existing.scheduledStartAt && input.scheduledEndAt === existing.scheduledEndAt && (input.timeZone ?? existing.timeZone) === existing.timeZone);
    if (unchanged) return { title: input.title.trim(), category, scheduleType: existing.scheduleType, recurrenceRule: existing.recurrenceRule,
        scheduledStartAt: existing.scheduledStartAt, scheduledEndAt: existing.scheduledEndAt, timeZone: existing.timeZone };
    const recurrenceRule = input.scheduleType === "recurring" ? validateRecurrence(input.recurrenceRule) : null;
    const scheduledStartAt = recurrenceRule ? firstOccurrenceAt(recurrenceRule) : (input as Extract<CreateTaskInput, { scheduleType: "one-time" }>).scheduledStartAt;
    const timeZone = recurrenceRule?.timeZone ?? (input as Extract<CreateTaskInput, { scheduleType: "one-time" }>).timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const scheduledEndAt = recurrenceRule ? occurrenceEndAt({ scheduleType: "recurring", scheduledEndAt: 0, recurrenceRule }, scheduledStartAt)
        : (input as Extract<CreateTaskInput, { scheduleType: "one-time" }>).scheduledEndAt;
    validateTime(scheduledStartAt); validateTime(scheduledEndAt);
    validatePlannedInstants(scheduledStartAt, scheduledEndAt, timeZone);
    const hours = getPlanningHours();
    assertPlanningRange(scheduledStartAt, scheduledEndAt, timeZone, hours);
    if (recurrenceRule) {
        const schedule = { id: existing?.id ?? 0, scheduleType: "recurring" as const, recurrenceRule, scheduledStartAt, scheduledEndAt,
            scheduleEffectiveAt: Date.now(), excludedOccurrences: existing?.excludedOccurrences };
        const from = Math.max(Date.now(), scheduledStartAt);
        // Compatible DST resolution can move an otherwise valid clock range
        // into a different local range. Check a complete seasonal cycle without writing rows.
        const validateSeason = (after: number) => {
            for (const at of expectedTimes(schedule, after, after + 370 * DAY)) {
                assertPlanningRange(at, occurrenceEndAt(schedule, at), timeZone, hours);
            }
        };
        try {
            validateSeason(from);
            // Excluding this year's transition does not exempt the open-ended
            // rule from the same transition in a later year.
            const afterExclusions = (existing?.excludedOccurrences ?? []).reduce((latest, range) => Math.max(latest, range.scheduledStartAt + 1), from);
            if (afterExclusions > from) validateSeason(afterExclusions);
        } catch (error) {
            throw new Error(`Invalid recurring range for "${input.title.trim()}": ${error instanceof Error ? error.message : "invalid seasonal range"}`, { cause: error });
        }
    }
    return { title: input.title.trim(), category, scheduleType: input.scheduleType, recurrenceRule, scheduledStartAt, scheduledEndAt, timeZone };

}

export function createTask(input: CreateTaskInput): Task {
    const values = validateTaskInput(input);
    const { recurrenceRule, scheduledStartAt } = values;
    const now = Date.now();
    if (values.scheduleType === "one-time" && scheduledStartAt < now) throw new Error("A new one-time schedule must be in the future");
    const through = recurrenceRule ? Math.max(now + 14 * DAY, scheduledStartAt) : scheduledStartAt;
    const times = recurrenceRule ? generateOccurrenceTimes(recurrenceRule, scheduledStartAt, through) : [scheduledStartAt];
    const task = repository.createTask({ ...values, scheduleEffectiveAt: scheduledStartAt,
        enabled: input.enabled ?? true, createdAt: now, updatedAt: now, generatedThrough: through }, rangesFor(values, times));
    return toTask(task);
}

export function updateTask(id: number, input: CreateTaskInput): Task {
    const task = requireTask(id);
    const values = validateTaskInput(input, task);
    const now = Date.now();
    const changed = task.scheduleType !== values.scheduleType || task.scheduledStartAt !== values.scheduledStartAt || task.scheduledEndAt !== values.scheduledEndAt || task.timeZone !== values.timeZone ||
        JSON.stringify(task.recurrenceRule) !== JSON.stringify(values.recurrenceRule);
    if (!changed) return toTask(repository.updateTask(id, { title: values.title, category: values.category, enabled: input.enabled ?? task.enabled, updatedAt: now }));
    const current = task.scheduleType === "one-time" ? repository.getOccurrenceAt(id, task.scheduledStartAt, task.scheduledEndAt) : undefined;
    if (current && occurrenceState(current) !== "planned") {
        if (values.scheduleType !== "one-time") throw new Error("A started or completed one-time task cannot change its schedule type to recurring.");
        return toTask(repository.correctOneTimePlan(id, current.id, { ...values, enabled: input.enabled ?? task.enabled,
            scheduleEffectiveAt: values.scheduledStartAt, generatedThrough: values.scheduledStartAt, updatedAt: now }));
    }
    if (values.scheduleType === "one-time" && values.scheduledStartAt < now) throw new Error("A changed one-time schedule must be in the future");
    const pastFrom = Math.max(task.scheduleEffectiveAt, task.generatedThrough === null ? task.scheduledStartAt : task.generatedThrough + 1);
    const past = rangesFor(task, expectedTimes(task, pastFrom, now));
    const through = values.recurrenceRule ? Math.max(now + 14 * DAY, values.scheduledStartAt) : values.scheduledStartAt;
    const future = rangesFor(values, expectedTimes({ ...values, id, scheduleEffectiveAt: now }, now, through + 1));
    return toTask(repository.updateTask(id, { ...values, enabled: input.enabled ?? task.enabled,
        scheduleEffectiveAt: now, generatedThrough: through, updatedAt: now }, { at: now, past, future }));
}

export function getWeekSchedule(from: number, to: number): WeekSchedule {
    validateTime(from);
    validateTime(to);
    if (to <= from || to - from > 8 * DAY) throw new Error("Choose a week range of at most eight days");
    const records = repository.getAllTasks();
    // Maintain existing bounded catch-up, independently of the browsed week.
    for (const task of records) materialize(task);
    const now = Date.now();
    return { tasks: records.map(toTask), occurrences: records.flatMap((task) => {
        const projected = deriveOccurrences(task, from - 2 * DAY, to, repository.listOccurrences(task.id, from - 2 * DAY, to));
        const byRange = new Map(projected.map((row) => [`${row.scheduledStartAt}:${row.scheduledEndAt}`, row]));
        for (const record of repository.listActualOccurrences(task.id, from, to)) {
            // Actual history cannot resurrect cards belonging to an obsolete rule.
            if (expectedTimes(task, record.scheduledStartAt, record.scheduledStartAt + 1).length && occurrenceEndAt(task, record.scheduledStartAt) === record.scheduledEndAt) {
                byRange.set(`${record.scheduledStartAt}:${record.scheduledEndAt}`, { taskId: task.id, scheduledStartAt: record.scheduledStartAt, scheduledEndAt: record.scheduledEndAt, record });
            }
        }
        return [...byRange.values()].filter((row) => { const range = occurrenceDisplayRange(row, now); return range.startAt < to && Math.max(range.endAt, range.startAt + 1) > from; });
    })
        .sort((left, right) => left.scheduledStartAt - right.scheduledStartAt || left.taskId - right.taskId) };
}

export function listOccurrences(taskId: number, from: number, to: number): TaskOccurrence[] {
    const task = requireTask(taskId);
    validateTime(from);
    validateTime(to);
    if (to <= from || to - from > 366 * DAY || to > Date.now() + 366 * DAY) {
        throw new Error("Choose a history range of at most 366 days, no more than one year ahead");
    }
    materialize(task, to);
    return repository.listOccurrences(taskId, from, to);
}


function resolveOccurrence(input: OccurrenceTarget, create = true): TaskOccurrence {
    if (!input) throw new Error("Invalid occurrence");
    const task = requireTask(input.taskId);
    let occurrence;
    if (input.occurrenceId !== undefined) {
        validateId(input.occurrenceId);
        occurrence = repository.getOccurrence(task.id, input.occurrenceId);
    } else {
        validateTime(input.scheduledStartAt);
        validateTime(input.scheduledEndAt);
        occurrence = repository.getOccurrenceAt(task.id, input.scheduledStartAt, input.scheduledEndAt);
        if (!occurrence && create && expectedTimes(task, input.scheduledStartAt, input.scheduledStartAt + 1).length === 1 && occurrenceEndAt(task, input.scheduledStartAt) === input.scheduledEndAt) {
            occurrence = repository.ensureOccurrence(task.id, input.scheduledStartAt, input.scheduledEndAt, Date.now());
        }
    }
    if (!occurrence) throw new Error("Task occurrence was not found in its schedule");
    return occurrence;
}

export function startOccurrence(input: OccurrenceTarget): TaskOccurrence {
    const occurrence = resolveOccurrence(input);
    if (isExcluded(requireTask(input.taskId), occurrence.scheduledStartAt, occurrence.scheduledEndAt)) throw new Error("Task occurrence was excluded from its schedule");
    if (occurrenceState(occurrence) === "missed") throw new Error("Missed occurrences cannot be started; use Start late in Details for today");
    if (occurrenceState(occurrence) !== "planned") return occurrence;
    const now = Date.now();
    return repository.saveProgress(occurrence.id, { startedAt: now, endedAt: null,
        recordedAt: occurrence.recordedAt ?? now, progressSource: "normal", legacyCompleted: false, updatedAt: now });
}

/** Preserve the missed record; this is a new independent attempt, not a resume. */
export function lateStartOccurrence(input: OccurrenceTarget, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): Task {
    const task = requireTask(input?.taskId), original = resolveOccurrence(input);
    const now = Date.now();
    if (occurrenceState(original, now) !== "missed") throw new Error("Only a Missed occurrence can be started late");
    if (!canLateStart(original.scheduledStartAt, now, timeZone)) throw new Error("Start late is available only for today's Missed occurrences");
    if (isExcluded(task, original.scheduledStartAt, original.scheduledEndAt)) throw new Error("Task occurrence was excluded from its schedule");
    const local = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone);
    const scheduledStartAt = local.round({ smallestUnit: "minute", roundingIncrement: 5, roundingMode: "halfExpand" }).epochMilliseconds;
    const scheduledEndAt = scheduledStartAt + original.scheduledEndAt - original.scheduledStartAt;
    validateTime(scheduledEndAt);
    return toTask(repository.createStartedTask({ title: task.title, category: task.category, enabled: task.enabled, origin: "user",
        scheduleType: "one-time", recurrenceRule: null, timeZone, scheduledStartAt, scheduledEndAt,
        scheduleEffectiveAt: scheduledStartAt, generatedThrough: scheduledStartAt, createdAt: now, updatedAt: now }, now));
}

export function getMissedTasks(): WeekSchedule {
    const tasks = getAllTasks(), definitions = new Map(repository.getAllTasks().map(task => [task.id, task]));
    const occurrences = repository.findMissedOccurrences(Date.now()).filter(row => {
        const task = definitions.get(row.taskId)!;
        return expectedTimes(task, row.scheduledStartAt, row.scheduledStartAt + 1).length === 1 && occurrenceEndAt(task, row.scheduledStartAt) === row.scheduledEndAt;
    }).map(record => ({ taskId: record.taskId, scheduledStartAt: record.scheduledStartAt, scheduledEndAt: record.scheduledEndAt, record }));
    return { tasks, occurrences };
}

export function updateOccurrencePlan(input: UpdateOccurrencePlanInput): Task {
    if (!input || typeof input.sync !== "boolean") throw new Error("Invalid occurrence plan");
    const task = requireTask(input.target?.taskId);
    if (task.scheduleType !== "recurring") {
        resolveOccurrence(input.target);
        return updateTask(task.id, input.changes);
    }
    if (input.sync) {
        resolveOccurrence(input.target);
        if (input.changes.scheduleType !== "recurring") throw new Error("A synced edit requires a recurring schedule");
        return updateTask(task.id, input.changes);
    }
    if (input.changes.scheduleType !== "one-time") throw new Error("An independent occurrence requires a one-time schedule");
    const values = validateTaskInput({ ...input.changes, category: input.changes.category === undefined ? task.category : input.changes.category });
    if (values.scheduledStartAt < Date.now()) throw new Error("A changed one-time schedule must be in the future");
    const original = resolveOccurrence(input.target);
    if (isExcluded(task, original.scheduledStartAt, original.scheduledEndAt)) throw new Error("Task occurrence was already excluded from its schedule");
    const now = Date.now();
    return toTask(repository.detachOccurrence(original, { ...values, enabled: input.changes.enabled ?? task.enabled,
        scheduleEffectiveAt: values.scheduledStartAt, generatedThrough: values.scheduledStartAt, createdAt: now, updatedAt: now }));
}

export function endOccurrence(input: OccurrenceTarget): TaskOccurrence {
    const occurrence = resolveOccurrence(input, false);
    if (occurrenceState(occurrence) === "completed") return occurrence;
    if (occurrence.startedAt === null) throw new Error("Start the occurrence before ending it");
    const now = Date.now();
    if (now < occurrence.startedAt) throw new Error("End time must not be earlier than start time");
    return repository.saveProgress(occurrence.id, { startedAt: occurrence.startedAt, endedAt: now,
        recordedAt: occurrence.recordedAt ?? now, progressSource: occurrence.progressSource ?? "normal", legacyCompleted: false, updatedAt: now });
}

function validateOccurrenceTimes(input: UpdateOccurrenceTimesInput) {
    if (!input) throw new Error("Invalid occurrence times");
    if (input.startedAt !== null) validateTime(input.startedAt);
    if (input.endedAt !== null) validateTime(input.endedAt);
    if (input.endedAt !== null && input.startedAt === null) throw new Error("Provide a start time before an end time");
    if (input.endedAt !== null && input.startedAt !== null && input.endedAt < input.startedAt) throw new Error("End time must not be earlier than start time");
}

export function updateOccurrenceTimes(input: UpdateOccurrenceTimesInput): TaskOccurrence {
    validateOccurrenceTimes(input);
    const occurrence = resolveOccurrence(input);
    const now = Date.now();
    if (occurrenceState(occurrence, now) === "missed" && input.startedAt === null && input.endedAt === null) throw new Error("Missed occurrences cannot be reset; enter actual times to correct history");
    return repository.saveProgress(occurrence.id, { startedAt: input.startedAt, endedAt: input.endedAt,
        recordedAt: occurrence.recordedAt ?? now, progressSource: occurrence.recordedAt === null ? "backfill" : "corrected",
        legacyCompleted: false, updatedAt: now });
}

/** Only the visual correction editor uses this semantic operation. */
export function correctOccurrenceTimes(input: UpdateOccurrenceTimesInput): TaskOccurrence {
    validateOccurrenceTimes(input);
    const task = requireTask(input.taskId);
    if (task.scheduleType !== "recurring") return updateOccurrenceTimes(input);
    const original = resolveOccurrence(input);
    if (isExcluded(task, original.scheduledStartAt, original.scheduledEndAt)) throw new Error("Task occurrence was already excluded from its schedule");
    if (original.startedAt === input.startedAt && original.endedAt === input.endedAt && !original.legacyCompleted) return original;
    const now = Date.now();
    return repository.detachOccurrenceWithActual(original, {
        title: task.title, category: task.category, enabled: task.enabled, origin: task.origin, timeZone: task.timeZone,
        scheduleType: "one-time", recurrenceRule: null, scheduledStartAt: original.scheduledStartAt, scheduledEndAt: original.scheduledEndAt,
        scheduleEffectiveAt: original.scheduledStartAt, generatedThrough: original.scheduledStartAt, createdAt: now, updatedAt: now,
    }, { startedAt: input.startedAt, endedAt: input.endedAt, recordedAt: original.recordedAt ?? now,
        progressSource: original.recordedAt === null ? "backfill" : "corrected", legacyCompleted: false, updatedAt: now });
}

/** A direct correction affects this occurrence only; a recurring parent is never rewritten. */
export function resizeOccurrence(input: ResizeOccurrenceInput): TaskOccurrence {
    if (!input || !["start", "end"].includes(input.edge)) throw new Error("Invalid resize request");
    validateTime(input.at);
    const task = requireTask(input.target?.taskId), original = resolveOccurrence(input.target);
    if (isExcluded(task, original.scheduledStartAt, original.scheduledEndAt)) throw new Error("Task occurrence was excluded from its schedule");
    if (occurrenceState(original) === "missed") throw new Error("Missed occurrences must be corrected in Details");
    if (occurrenceState(original) !== input.expectedState) throw new Error("Task state changed; refresh and try again");
    const occurrence = { taskId: task.id, scheduledStartAt: original.scheduledStartAt, scheduledEndAt: original.scheduledEndAt, record: original };
    const field = resizeField(occurrence, input.edge);
    const at = Temporal.Instant.fromEpochMilliseconds(input.at).toZonedDateTimeISO(task.timeZone);
    if (at.minute % 5 || at.second || at.millisecond) throw new Error("Choose times in five-minute steps");
    const previous = original[field];
    if (previous === input.at) return original;
    if (previous === null || !Temporal.Instant.fromEpochMilliseconds(previous).toZonedDateTimeISO(task.timeZone).toPlainDate().equals(at.toPlainDate())) throw new Error("Drag within the same day (00:00–23:55); use Details for other dates");
    const next = resizeOccurrenceRange(occurrence, input.edge, input.at);
    const planned = field === "scheduledStartAt" || field === "scheduledEndAt";
    if (planned) {
        validatePlannedInstants(next.scheduledStartAt, next.scheduledEndAt, task.timeZone);
        assertPlanningRange(next.scheduledStartAt, next.scheduledEndAt, task.timeZone, getPlanningHours());
    }
    const now = Date.now();
    if (task.scheduleType === "recurring") return repository.detachOccurrenceWithActual(original, {
        title: task.title, category: task.category, enabled: task.enabled, origin: task.origin, timeZone: task.timeZone,
        scheduleType: "one-time", recurrenceRule: null, scheduledStartAt: next.scheduledStartAt, scheduledEndAt: next.scheduledEndAt,
        scheduleEffectiveAt: next.scheduledStartAt, generatedThrough: next.scheduledStartAt, createdAt: now, updatedAt: now,
    }, { startedAt: next.startedAt, endedAt: next.endedAt,
        recordedAt: planned ? original.recordedAt : original.recordedAt ?? now,
        progressSource: planned ? original.progressSource : original.recordedAt === null ? "backfill" : "corrected",
        legacyCompleted: original.legacyCompleted, updatedAt: now });
    if (planned) {
        repository.correctOneTimePlan(task.id, original.id, { scheduledStartAt: next.scheduledStartAt, scheduledEndAt: next.scheduledEndAt,
            scheduleEffectiveAt: next.scheduledStartAt, generatedThrough: next.scheduledStartAt, updatedAt: now });
        return repository.getOccurrence(task.id, original.id)!;
    }
    return updateOccurrenceTimes({ taskId: task.id, occurrenceId: original.id, startedAt: next.startedAt, endedAt: next.endedAt });
}

export function setTaskEnabled(id: number, enabled: boolean): void {
    requireTask(id);
    if (typeof enabled !== "boolean") throw new Error("Enabled must be a boolean");
    repository.setTaskEnabled(id, enabled, Date.now());
}

const pendingDeletions = new Map<string, { id: number; deletedAt: number; enabled: boolean; updatedAt: number; expiresAt: number }>();

export function deleteTask(id: number): TaskDeletionReceipt {
    const task = requireTask(id), now = Date.now();
    materialize(task, now);
    repository.deleteTask(id, now);
    for (const [token, entry] of pendingDeletions) if (entry.expiresAt <= now) pendingDeletions.delete(token);
    const undoToken = randomUUID(), expiresAt = now + TASK_DELETE_UNDO_MS;
    pendingDeletions.set(undoToken, { id, deletedAt: now, enabled: task.enabled, updatedAt: task.updatedAt, expiresAt });
    return { undoToken, expiresAt };
}

export function undoTaskDeletion(token: string): void {
    const entry = typeof token === "string" ? pendingDeletions.get(token) : undefined;
    if (!entry || Date.now() >= entry.expiresAt) {
        if (typeof token === "string") pendingDeletions.delete(token);
        throw new Error("Task deletion undo is expired or unavailable");
    }
    if (!repository.restoreDeletedTask(entry.id, entry.deletedAt, entry.enabled, entry.updatedAt)) throw new Error("Task deletion undo is unavailable");
    pendingDeletions.delete(token);
}
