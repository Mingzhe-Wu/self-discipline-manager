import { createContext, useContext } from "react";
import { formatDuration } from "./taskFormatting";

export const TOAST_DURATION = 2800;
export interface ToastOptions { expiresAt?: number; action?: { label: string; run: () => Promise<void> } }
export const ToastContext = createContext<(message: string, options?: ToastOptions) => void>(() => {});
export function useToast() { return useContext(ToastContext); }

export function lifecycleToast(action: "start" | "finish" | "reset", title: string, record?: { startedAt: number | null; endedAt: number | null }): string {
    if (action === "reset") return `"${title}" reset to Planned`;
    if (action === "start") return `Started "${title}"${record?.startedAt == null ? "" : ` at ${new Date(record.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`}`;
    return `Finished "${title}"${record?.startedAt == null || record.endedAt == null ? "" : ` · ${formatDuration(record.endedAt - record.startedAt)}`}`;
}
