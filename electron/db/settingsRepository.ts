import { eq } from "drizzle-orm";
import type { PlanningHours } from "../../shared/types/settings";
import { getDatabase } from "./database";
import { planningSettingsTable } from "./schema";

export function getPlanningHours(): PlanningHours | undefined {
    const row = getDatabase().select().from(planningSettingsTable).where(eq(planningSettingsTable.id, 1)).get();
    return row ? { wakeTime: row.wakeTime, sleepTime: row.sleepTime } : undefined;
}

export function savePlanningHours(hours: PlanningHours): PlanningHours {
    getDatabase().insert(planningSettingsTable).values({ id: 1, ...hours })
        .onConflictDoUpdate({ target: planningSettingsTable.id, set: hours }).run();
    return { ...hours };
}
