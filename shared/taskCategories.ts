/** Stable persisted keys; labels and emoji are display metadata only. */
export const TASK_CATEGORIES = [
    { key: "study", label: "Study", emoji: "📚" },
    { key: "work", label: "Work", emoji: "💼" },
    { key: "exercise", label: "Exercise", emoji: "🏃" },
    { key: "personal", label: "Personal", emoji: "🧍" },
    { key: "chores", label: "Chores", emoji: "🧹" },
    { key: "meal", label: "Meal", emoji: "🍽️" },
    { key: "rest", label: "Rest", emoji: "😴" },
    { key: "entertainment", label: "Entertainment", emoji: "🎮" },
    { key: "other", label: "Other", emoji: "📌" },
] as const;

export type TaskCategory = typeof TASK_CATEGORIES[number]["key"];
export const TASK_CATEGORY_KEYS = TASK_CATEGORIES.map((category) => category.key) as [TaskCategory, ...TaskCategory[]];
export function isTaskCategory(value: unknown): value is TaskCategory {
    return TASK_CATEGORIES.some((category) => category.key === value);
}
export function categoryMetadata(key: unknown) {
    return TASK_CATEGORIES.find((category) => category.key === key) ?? TASK_CATEGORIES[8];
}
