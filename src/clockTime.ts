export const CLOCK_HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
export const CLOCK_MINUTES = Array.from({ length: 12 }, (_, slot) => String(slot * 5).padStart(2, "0"));

export function replaceClockPart(value: string, part: "hour" | "minute", next: string) {
    const [hour = "", minute = ""] = value.split(":");
    const nextHour = part === "hour" ? next : hour;
    const nextMinute = part === "minute" ? next : minute;
    return nextHour || nextMinute ? `${nextHour}:${nextMinute}` : "";
}
