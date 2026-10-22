import { BrowserWindow, Menu, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { observeFullscreen } from "./fullscreenObserver";
import { fitMiniBounds, resizeMiniBounds, MINI_WIDTH, MINI_HEIGHT } from "./miniGeometry";
import type { MiniWindowState, MiniResizeEdge, MiniPointer } from "../../shared/types/mini";

export function createMiniWindowController({ userData, rendererUrl, preload, onVisibilityChange }: {
    userData: string; rendererUrl: string; preload: string; onVisibilityChange: () => void;
}) {
    const file = path.join(userData, "mini-window-state.json");
    let window: BrowserWindow | null = null, loading: Promise<void> | null = null;
    let disposed = false, enabled = false, saveTimer: NodeJS.Timeout | undefined;
    let visibilityRevision = 0, changingBounds = false, wantsVisible = false, fullscreen = false;
    let panelSize = { width: MINI_WIDTH, height: MINI_HEIGHT };
    let state: MiniWindowState = { mode: "ball", edge: null };
    let drag: { x: number; y: number; pointerX: number; pointerY: number } | null = null;
    let resize: { edge: MiniResizeEdge; pointer: MiniPointer; bounds: Electron.Rectangle; area: Electron.Rectangle } | null = null;
    let previewOrigin: { bounds: Electron.Rectangle; state: MiniWindowState } | null = null;
    let ballMenuOpen = false;
    const areas = () => screen.getAllDisplays().map(display => display.workArea);
    const size = () => state.mode === "expanded" ? panelSize : { width: state.mode === "docked" ? 32 : 56, height: 56 };
    const getState = (): MiniWindowState => ({ ...state });
    function save() {
        if (saveTimer) clearTimeout(saveTimer); saveTimer = undefined;
        if (!window || window.isDestroyed()) return;
        try {
            fs.writeFileSync(file + ".tmp", JSON.stringify({ ...(previewOrigin?.bounds ?? window.getBounds()), ...(previewOrigin?.state ?? state), panelSize }), "utf8");
            fs.renameSync(file + ".tmp", file);
        } catch (error) { console.error("Could not save mini window position", error); }
    }
    function place(position: unknown) {
        if (!window || window.isDestroyed()) return;
        changingBounds = true;
        let bounds = fitMiniBounds(position, areas(), size());
        if (state.mode === "docked") {
            const area = screen.getDisplayMatching(bounds).workArea;
            bounds = { ...bounds, x: state.edge === "left" ? area.x : area.x + area.width - bounds.width };
        }
        // Use client-side grips for consistent cursors on transparent Windows windows.
        window.setResizable(false);
        window.setMinimumSize(state.mode === "expanded" ? Math.min(260, bounds.width) : 0, state.mode === "expanded" ? Math.min(280, bounds.height) : 0);
        window.setBounds(bounds);
        changingBounds = false;
    }
    function emit() { window?.webContents.send("mini:window-state", getState()); save(); }
    function fit() { if (window && !window.isDestroyed()) { place(window.getBounds()); emit(); } }
    function dock() {
        if (!window || window.isDestroyed() || changingBounds || drag || state.mode !== "ball") return;
        const bounds = window.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
        const left = bounds.x - area.x <= 12, right = area.x + area.width - bounds.x - bounds.width <= 12;
        if (!left && !right) return;
        state = { mode: "docked", edge: left ? "left" : "right" };
        place(bounds); emit();
    }
    function expand() {
        if (!window || window.isDestroyed()) return;
        if (state.preview) { previewOrigin = null; state = { mode: "expanded", edge: null }; emit(); return; }
        const bounds = window.getBounds(), edge = state.edge;
        state = { mode: "expanded", edge: null };
        place({ x: edge === "left" ? bounds.x : bounds.x + bounds.width - panelSize.width, y: bounds.y + bounds.height - panelSize.height }); emit();
    }
    function preview() {
        if (!window || window.isDestroyed() || drag || state.mode === "expanded" || fullscreen || !wantsVisible) return;
        previewOrigin = { bounds: window.getBounds(), state: { ...state } };
        expand(); state = { ...state, edge: previewOrigin.state.edge, preview: true }; emit();
    }
    function endPreview() {
        if (!state.preview || !previewOrigin || drag || ballMenuOpen) return;
        const origin = previewOrigin; previewOrigin = null; state = origin.state;
        place(origin.bounds); emit(); dock();
    }
    function collapse() {
        if (!window || window.isDestroyed()) return;
        if (state.preview) { endPreview(); return; }
        const bounds = window.getBounds(); state = { mode: "ball", edge: null };
        place({ x: bounds.x + bounds.width - 56, y: bounds.y + bounds.height - 56 }); emit(); dock();
    }
    screen.on("display-removed", fit); screen.on("display-metrics-changed", fit);
    function reveal() {
        if (!window || window.isDestroyed() || !wantsVisible || fullscreen || disposed) return;
        window.showInactive();
        window.setAlwaysOnTop(true, process.platform === "win32" ? "normal" : "floating");
    }
    const stopObserving = observeFullscreen(active => {
        const wasFullscreen = fullscreen;
        fullscreen = active;
        if (active) { ballMenuOpen = false; drag = null; endPreview(); resize = null; window?.hide(); }
        else if (wasFullscreen) reveal();
    });
    function hide() { ballMenuOpen = false; drag = null; endPreview(); wantsVisible = false; ++visibilityRevision; resize = null; if (window && !window.isDestroyed()) { save(); window.hide(); } }
    async function show() {
        if (disposed) return;
        wantsVisible = true;
        const revision = ++visibilityRevision;
        if (!window || window.isDestroyed()) {
            let saved: { x?: number; y?: number; width?: number; height?: number; mode?: string; edge?: string; panelSize?: { width?: number; height?: number } } | null = null;
            try { if (fs.statSync(file).size <= 4096) saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* First use or invalid saved position. */ }
            if (Number.isSafeInteger(saved?.panelSize?.width) && Number.isSafeInteger(saved?.panelSize?.height)) {
                panelSize = { width: Math.max(260, Math.min(800, saved!.panelSize!.width!)), height: Math.max(280, Math.min(1000, saved!.panelSize!.height!)) };
            }
            state = saved?.mode === "docked" && (saved.edge === "left" || saved.edge === "right") ? { mode: "docked", edge: saved.edge } : { mode: "ball", edge: null };
            const position = saved && (saved.mode === "expanded" || !saved.mode) ? { x: (saved.x ?? 0) + (saved.width ?? MINI_WIDTH) - 56, y: (saved.y ?? 0) + (saved.height ?? MINI_HEIGHT) - 56 } : saved;
            const widget = new BrowserWindow({ ...fitMiniBounds(position, areas(), size()), show: false, frame: false,
                transparent: true, hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
                alwaysOnTop: true, backgroundColor: "#00000000", title: "Today — Self Discipline Manager",
                webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false } });
            window = widget; place(widget.getBounds()); widget.removeMenu();
            widget.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
            widget.webContents.on("will-navigate", event => event.preventDefault());
            widget.webContents.on("will-redirect", event => event.preventDefault());
            widget.webContents.on("preload-error", (_event, _file, error) => console.error("Mini preload failed", error));
            widget.on("close", event => { if (!disposed) { event.preventDefault(); if (state.mode === "expanded") collapse(); } });
            widget.on("move", () => { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); });
            widget.on("resize", () => {
                if (state.mode === "expanded" && !changingBounds) {
                    const { width, height } = widget.getBounds(); panelSize = { width, height };
                    if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(save, 250);
                }
            });
            widget.on("moved", dock);
            widget.on("show", () => { widget.webContents.send("data:changed"); onVisibilityChange(); });
            widget.on("hide", onVisibilityChange);
            widget.on("closed", () => { if (window === widget) window = null; onVisibilityChange(); });
            loading = widget.loadURL(rendererUrl).catch(error => { if (!widget.isDestroyed()) widget.destroy(); if (!disposed) throw error; }).finally(() => { loading = null; });
        }
        if (loading) await loading;
        if (!disposed && revision === visibilityRevision && window && !window.isDestroyed()) {
            fit(); reveal();
        }
    }
    return {
        getWindow: () => window, getState, preview, endPreview, expand, collapse,
        showBallMenu() {
            if (!window || window.isDestroyed() || !window.isVisible() || ballMenuOpen || (state.mode === "expanded" && !state.preview)) return;
            const menu = Menu.buildFromTemplate([{ id: "close-mini-ball", label: "Close floating ball", click: hide }]);
            ballMenuOpen = true;
            try {
                menu.popup({ window, callback: () => {
                    ballMenuOpen = false;
                    if (!window || window.isDestroyed() || !state.preview) return;
                    const pointer = screen.getCursorScreenPoint(), bounds = window.getBounds();
                    if (pointer.x < bounds.x || pointer.x >= bounds.x + bounds.width || pointer.y < bounds.y || pointer.y >= bounds.y + bounds.height) endPreview();
                } });
            } catch (error) { ballMenuOpen = false; throw error; }
        },
        beginResize(edge: MiniResizeEdge, pointer: MiniPointer) {
            if (!["n", "s", "e", "w", "ne", "nw", "se", "sw"].includes(edge)) throw new Error("Invalid resize edge");
            if (!pointer || ![pointer.x, pointer.y].every(value => Number.isFinite(value) && Math.abs(value) < 1_000_000)) throw new Error("Invalid pointer");
            if (!window || window.isDestroyed() || state.mode !== "expanded") return;
            if (state.preview) expand();
            const bounds = window.getBounds();
            resize = { edge, pointer, bounds, area: screen.getDisplayMatching(bounds).workArea };
        },
        moveResize(pointer: MiniPointer) {
            if (!pointer || ![pointer.x, pointer.y].every(value => Number.isFinite(value) && Math.abs(value) < 1_000_000)) throw new Error("Invalid pointer");
            if (!resize || state.mode !== "expanded") return;
            const bounds = resizeMiniBounds(resize.bounds, resize.edge, pointer.x - resize.pointer.x, pointer.y - resize.pointer.y, resize.area);
            panelSize = { width: bounds.width, height: bounds.height }; place(bounds);
        },
        endResize() { resize = null; save(); },
        beginDrag() {
            if (!window || window.isDestroyed() || (state.mode === "expanded" && !state.preview) || drag) return;
            const pointer = screen.getCursorScreenPoint();
            const origin = window.getBounds();
            // Move an existing preview as one window instead of collapsing it.
            drag = { x: origin.x, y: origin.y, pointerX: pointer.x, pointerY: pointer.y };
            if (state.mode === "docked") {
                const bounds = window.getBounds(), edge = state.edge;
                state = { mode: "ball", edge: null };
                place({ x: edge === "right" ? bounds.x + bounds.width - 56 : bounds.x, y: bounds.y });
                emit();
            }
            const bounds = window.getBounds();
            drag.x = bounds.x; drag.y = bounds.y;
        },
        moveDrag() {
            if (!drag) return;
            const pointer = screen.getCursorScreenPoint();
            place({ x: drag.x + pointer.x - drag.pointerX, y: drag.y + pointer.y - drag.pointerY });
            if (previewOrigin && window && !window.isDestroyed()) {
                const bounds = window.getBounds();
                previewOrigin = {
                    state: { mode: "ball", edge: null },
                    bounds: fitMiniBounds({ x: state.edge === "left" ? bounds.x : bounds.x + bounds.width - 56, y: bounds.y + bounds.height - 56 }, areas(), { width: 56, height: 56 }),
                };
            }
        },
        endDrag() { drag = null; dock(); save(); },
        isVisible: () => !!window && !window.isDestroyed() && window.isVisible(), show, hide,
        async applyPreference(next: boolean) { if (next === enabled) return; enabled = next; if (next) await show(); else hide(); },
        dispose() {
            disposed = true; stopObserving(); save();
            screen.removeListener("display-removed", fit); screen.removeListener("display-metrics-changed", fit);
            window?.destroy(); window = null;
        },
    };
}
