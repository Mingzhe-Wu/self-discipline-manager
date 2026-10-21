export interface PlanningHours {
    wakeTime: string;
    sleepTime: string;
}

export interface LocalProfile {
    id: number;
    displayName: string;
    createdAt: number;
    updatedAt: number;
}

export interface UserSettings extends PlanningHours {
    defaultTaskDurationMinutes: number;
    weekStartsOn: 0 | 1;
    notificationsEnabled: boolean;
    trayMiniEnabled: boolean;
    closeToTray: boolean;
}

export interface LocalPreferences { profile: LocalProfile; settings: UserSettings }
export interface UpdateLocalPreferencesInput { displayName: string; settings: UserSettings }
export type UpdateUserSettingsInput = Partial<UserSettings>;

export const DEFAULT_USER_SETTINGS: Readonly<UserSettings> = Object.freeze({
    wakeTime: "00:00", sleepTime: "24:00", defaultTaskDurationMinutes: 60,
    weekStartsOn: 1, notificationsEnabled: true, trayMiniEnabled: false, closeToTray: true,
});
