import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { TOAST_DURATION, ToastContext } from "../toast";
import type { ToastOptions } from "../toast";
import { errorMessage } from "../taskFormatting";
import Icon from "./Icon";

type Toast = { id: number; message: string; expiresAt: number; action?: ToastOptions["action"] };

function ToastEntry({ toast, dismiss }: { toast: Toast; dismiss: (id: number) => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const pending = useRef(false);
    useEffect(() => {
        if (busy || error) return;
        const timer = window.setTimeout(() => dismiss(toast.id), Math.max(0, toast.expiresAt - Date.now()));
        return () => window.clearTimeout(timer);
    }, [toast, dismiss, busy, error]);
    async function runAction() {
        if (!toast.action || pending.current) return;
        if (Date.now() >= toast.expiresAt) { dismiss(toast.id); return; }
        pending.current = true;
        setBusy(true);
        try { await toast.action.run(); dismiss(toast.id); }
        catch (failure) { setError(`Could not undo deletion. ${errorMessage(failure)}`); }
        finally { pending.current = false; setBusy(false); }
    }
    return <div className={`app-toast${error ? " is-error" : ""}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-atomic="true" aria-busy={busy}>
        <Icon name="check" /><span>{error || toast.message}</span>
        {toast.action && !error && <button type="button" className="toast-action" disabled={busy} onClick={() => void runAction()}>{toast.action.label}</button>}
        <button type="button" aria-label="Dismiss notification" disabled={busy} onClick={() => dismiss(toast.id)}><Icon name="close" /></button>
    </div>;
}

export default function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const sequence = useRef(0);
    const element = useRef<HTMLDivElement>(null);
    const notify = useCallback((message: string, options?: ToastOptions) => setToasts(current => [...current, { id: ++sequence.current, message, expiresAt: options?.expiresAt ?? Date.now() + TOAST_DURATION, action: options?.action }]), []);
    const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), []);
    useEffect(() => {
        const node = element.current;
        if (!node) return;
        if (node.matches(":popover-open")) node.hidePopover();
        // Reopen in the non-modal top layer so feedback also appears above a
        // newly opened details dialog. Each entry keeps its own expiry.
        if (toasts.length) node.showPopover();
    }, [toasts]);
    return <ToastContext.Provider value={notify}>
        {children}
        <div ref={element} popover="manual" className="toast-stack">
            {toasts.map(toast => <ToastEntry key={toast.id} toast={toast} dismiss={dismiss} />)}
        </div>
    </ToastContext.Provider>;
}
