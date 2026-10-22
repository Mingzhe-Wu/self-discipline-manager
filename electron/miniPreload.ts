import { contextBridge, ipcRenderer } from "electron";
import type { MiniWindowState, MiniResizeEdge, MiniPointer } from "../shared/types/mini";
import type { OccurrenceTarget } from "../shared/types/task";

contextBridge.exposeInMainWorld("miniAPI", {
    openTask: (target: OccurrenceTarget) => ipcRenderer.invoke("mini:open-task", target),
    beginResize: (edge: MiniResizeEdge, pointer: MiniPointer) => ipcRenderer.invoke("mini:begin-resize", edge, pointer),
    moveResize: (pointer: MiniPointer) => ipcRenderer.invoke("mini:move-resize", pointer),
    endResize: () => ipcRenderer.invoke("mini:end-resize"),
    getWindowState: () => ipcRenderer.invoke("mini:state"),
    preview: () => ipcRenderer.invoke("mini:preview"),
    endPreview: () => ipcRenderer.invoke("mini:endPreview"),
    expand: () => ipcRenderer.invoke("mini:expand"),
    collapse: () => ipcRenderer.invoke("mini:collapse"),
    beginDrag: () => ipcRenderer.invoke("mini:beginDrag"),
    moveDrag: () => ipcRenderer.invoke("mini:moveDrag"),
    endDrag: () => ipcRenderer.invoke("mini:endDrag"),
    onWindowStateChanged: (callback: (state: MiniWindowState) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, state: MiniWindowState) => callback(state);
        ipcRenderer.on("mini:window-state", listener);
        return () => ipcRenderer.removeListener("mini:window-state", listener);
    },
    getToday: () => ipcRenderer.invoke("mini:today"),
    start: (target: OccurrenceTarget) => ipcRenderer.invoke("mini:start", target),
    finish: (target: OccurrenceTarget) => ipcRenderer.invoke("mini:finish", target),
    showBallMenu: () => ipcRenderer.invoke("mini:ball-menu"),
    openMain: () => ipcRenderer.invoke("mini:open-main"),
    onDataChanged: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("data:changed", listener);
        return () => ipcRenderer.removeListener("data:changed", listener);
    },
});
