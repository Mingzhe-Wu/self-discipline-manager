type IconName = "open-details" | "calendar" | "plus" | "chevron-left" | "chevron-right" | "close" | "check";

const paths: Record<IconName, string> = {
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
