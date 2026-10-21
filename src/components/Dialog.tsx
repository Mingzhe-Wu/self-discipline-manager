import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import Icon from "./Icon";

export default function Dialog({ title, onClose, children, panel = false, closeLabel = "Close", busy = false, fallbackFocus }: {
    title: string; onClose: () => void; children: ReactNode; panel?: boolean; closeLabel?: string; busy?: boolean; fallbackFocus: RefObject<HTMLElement | null>;
}) {
    const element = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const fallback = fallbackFocus.current;
        const dialog = element.current;
        dialog?.showModal();
        dialog?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
        return () => {
            dialog?.close();
            if (previous?.isConnected && previous !== document.body && !previous.matches(":disabled")) previous.focus();
            if ((!previous || document.activeElement !== previous || previous === document.body) && fallback?.isConnected) fallback.focus();
        };
    }, [fallbackFocus]);
    return (
        <dialog ref={element} className={panel ? "app-dialog detail-dialog" : "app-dialog"} aria-labelledby={titleId}
            onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
            onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                if (!busy && event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onClose();
            }}>
            <div className="dialog-surface">
                <header className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" disabled={busy} aria-label={closeLabel} onClick={onClose}><Icon name="close" /></button></header>
                <div className="dialog-body">{children}</div>
            </div>
        </dialog>
    );
}
