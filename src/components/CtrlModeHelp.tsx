import { useId, useState } from "react";

export default function CtrlModeHelp() {
    const id = useId();
    const [pinned, setPinned] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const open = pinned || hovered || focused;
    return <div className={`ctrl-mode-help${open ? " is-open" : ""}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setPinned(false); setFocused(false); } }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setPinned(false); setHovered(false); setFocused(false); event.currentTarget.querySelector("button")?.blur(); } }}>
        <button type="button" className="icon-button ctrl-help-button" aria-label="Ctrl mode guidance" aria-controls={id} aria-expanded={open} onClick={() => { setPinned(value => !value); setFocused(false); }}>?</button>
        <div id={id} className="ctrl-help-panel" role="note">
            <strong>Ctrl mode guidance:</strong>
            <ul>
                <li>Hold ctrl to enter ctrl mode</li>
                <li>Click empty space to set the start time</li>
                <li>Move the pointer to preview the end time</li>
                <li>Click again to confirm the end time</li>
                <li>Guide line shows the current pointer time</li>
                <li>Right-click while selecting to cancel</li>
                <li>Double-click empty space to create a task without choosing an end time</li>
                <li>Drag an existing task edge to adjust its start/end time<br /><span>(planned or actual, depending on task state)</span></li>
            </ul>
        </div>
    </div>;
}
