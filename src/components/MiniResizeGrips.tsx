import { useRef } from "react";
import type { MiniResizeEdge } from "../../shared/types/mini";

const EDGES: MiniResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** Client grips avoid the inconsistent native cursor on transparent windows. */
export default function MiniResizeGrips({ onError }: { onError: (error: unknown) => void }) {
    const active = useRef<number | null>(null);
    const end = () => { if (active.current === null) return; active.current = null; void window.miniAPI.endResize().catch(onError); };
    return <>{EDGES.map(edge => <div key={edge} aria-hidden="true" className={`mini-resize-grip edge-${edge}`}
        onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation();
            active.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            void window.miniAPI.beginResize(edge, { x: event.screenX, y: event.screenY }).catch(onError);
        }}
        onPointerMove={event => {
            if (active.current !== event.pointerId) return;
            event.stopPropagation();
            void window.miniAPI.moveResize({ x: event.screenX, y: event.screenY }).catch(onError);
        }}
        onPointerUp={event => { if (event.button === 0) { event.stopPropagation(); end(); } }}
        onPointerCancel={end} onLostPointerCapture={end}
    />)}</>;
}
