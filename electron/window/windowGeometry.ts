import fs from "node:fs";
import type { BrowserWindow, Screen } from "electron";
import type { WorkArea } from "./windowSizing";

interface Geometry extends WorkArea { maximized: boolean }
type WindowBounds = WorkArea & { minWidth: number; minHeight: number };
const minimumWidth = 760;
const minimumHeight = 500;

function validRectangle(value: unknown): value is WorkArea {
    if (!value || typeof value !== "object") return false;
    const rectangle = value as WorkArea;
    return [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isSafeInteger)
        && Math.abs(rectangle.x) <= 1_000_000 && Math.abs(rectangle.y) <= 1_000_000
        && rectangle.width >= 1 && rectangle.width <= 32768
        && rectangle.height >= 1 && rectangle.height <= 32768;
}

function fitRectangle(rectangle: WorkArea, workAreas: WorkArea[]): WorkArea {
    const areas = workAreas.filter(validRectangle);
    if (!areas.length) return rectangle;
    // Prefer the display containing most of the window. If it disappeared, use
    // the closest remaining display, including displays with negative origins.
    const overlap = (area: WorkArea) => Math.max(0, Math.min(rectangle.x + rectangle.width, area.x + area.width) - Math.max(rectangle.x, area.x))
        * Math.max(0, Math.min(rectangle.y + rectangle.height, area.y + area.height) - Math.max(rectangle.y, area.y));
    const distance = (area: WorkArea) => Math.hypot(rectangle.x + rectangle.width / 2 - area.x - area.width / 2, rectangle.y + rectangle.height / 2 - area.y - area.height / 2);
    const area = areas.reduce((best, candidate) => overlap(candidate) > overlap(best)
        || (overlap(candidate) === overlap(best) && distance(candidate) < distance(best)) ? candidate : best);
    const width = Math.min(Math.max(rectangle.width, minimumWidth), area.width);
    const height = Math.min(Math.max(rectangle.height, minimumHeight), area.height);
    return { x: Math.max(area.x, Math.min(rectangle.x, area.x + area.width - width)),
        y: Math.max(area.y, Math.min(rectangle.y, area.y + area.height - height)), width, height };
}

export function loadWindowGeometry(file: string, workAreas: WorkArea[], fallback: WindowBounds) {
    try {
        if (fs.statSync(file).size > 4096) throw new Error("Window state is too large");
        const saved: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!validRectangle(saved) || typeof (saved as Geometry).maximized !== "boolean") throw new Error("Invalid window state");
        const bounds = fitRectangle(saved, workAreas);
        return { bounds: { ...bounds, minWidth: Math.min(minimumWidth, bounds.width), minHeight: Math.min(minimumHeight, bounds.height) }, maximized: (saved as Geometry).maximized };
    } catch {
        return { bounds: fallback, maximized: false };
    }
}

/** Track the normal rectangle separately from minimized/maximized native bounds.
 * The returned function writes only when the caller has confirmed a normal quit. */
export function trackWindowGeometry(window: BrowserWindow, file: string, displays: Screen) {
    let normal = window.getNormalBounds();
    let maximized = window.isMaximized();
    let pendingReposition = false;
    const capture = () => {
        if (window.isDestroyed() || window.isMinimized() || window.isMaximized() || pendingReposition) return;
        const bounds = window.getNormalBounds();
        if (validRectangle(bounds)) normal = bounds;
    };
    const workAreas = () => displays.getAllDisplays().map((display) => display.workArea);
    const reposition = () => {
        if (window.isDestroyed()) return;
        const fitted = fitRectangle(normal, workAreas());
        if (!pendingReposition && fitted.x === normal.x && fitted.y === normal.y && fitted.width === normal.width && fitted.height === normal.height) return;
        normal = fitted;
        pendingReposition = true;
        if (!window.isMinimized() && !window.isMaximized()) {
            window.setMinimumSize(Math.min(minimumWidth, fitted.width), Math.min(minimumHeight, fitted.height));
            window.setBounds(fitted);
            pendingReposition = false;
        }
    };
    window.on("move", capture);
    window.on("resize", capture);
    window.on("maximize", () => { maximized = true; });
    window.on("unmaximize", () => { maximized = false; capture(); reposition(); });
    window.on("restore", () => { reposition(); });
    displays.on("display-removed", reposition);
    displays.on("display-metrics-changed", reposition);
    window.once("closed", () => {
        displays.removeListener("display-removed", reposition);
        displays.removeListener("display-metrics-changed", reposition);
    });
    return () => {
        if (window.isDestroyed()) return;
        capture();
        if (!validRectangle(normal)) return;
        const rectangle = fitRectangle(normal, workAreas());
        const temporaryFile = `${file}.tmp`;
        try {
            fs.writeFileSync(temporaryFile, JSON.stringify({ ...rectangle, maximized }), "utf8");
            fs.renameSync(temporaryFile, file);
        } catch {
            // A read-only or unavailable profile must not prevent shutdown.
            try { fs.unlinkSync(temporaryFile); } catch { /* No temporary file. */ }
        }
    };
}
