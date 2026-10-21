type IconName = "open-details" | "calendar" | "plus" | "chevron-left" | "chevron-right" | "close" | "check" | "clock" | "hourglass" | "activity" | "tag" | "bell" | "trash";

const paths: Record<IconName, string> = {
    clock: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    hourglass: "M5 3h14M5 21h14M7 3v4l5 5-5 5v4m10-18v4l-5 5 5 5v4",
    activity: "M5 18v-4m7 4V9m7 9V4",
    tag: "M3 3h8l10 10-8 8L3 11V3Zm4 4h.01",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
    "open-details": "M7 17 17 7M7 7h10v10",
    calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    plus: "M12 5v14M5 12h14",
    "chevron-left": "m15 5-7 7 7 7",
    "chevron-right": "m9 5 7 7-7 7",
    close: "m6 6 12 12M6 18 18 6",
    check: "m5 12 4 4L19 6",
};

export default function Icon({ name, className = "" }: { name: IconName; className?: string }) {
    return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
