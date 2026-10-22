import { ipcMain } from "electron";
import type { MiniWindowState, MiniTaskDetails, MiniResizeEdge, MiniPointer } from "../../shared/types/mini";
import type { OccurrenceTarget } from "../../shared/types/task";
import type { SenderValidator } from "./validateSender";
import { getMiniToday, getMiniTaskDetails } from "../services/miniService";
import { startOccurrence, endOccurrence } from "../services/taskService";

export function registerMiniIpc(validate: SenderValidator, actions: { showBallMenu: () => void; openMain: () => void; changed: () => void; getState: () => MiniWindowState; preview: () => void; endPreview: () => void; expand: () => void; collapse: () => void; beginDrag: () => void; moveDrag: () => void; endDrag: () => void; openTask: (details: MiniTaskDetails) => void; beginResize: (edge: MiniResizeEdge, pointer: MiniPointer) => void; moveResize: (pointer: MiniPointer) => void; endResize: () => void }) {
    ipcMain.handle("mini:open-task", (event, target: OccurrenceTarget) => { validate(event); actions.openTask(getMiniTaskDetails(target)); });
    ipcMain.handle("mini:begin-resize", (event, edge: MiniResizeEdge, pointer: MiniPointer) => { validate(event); actions.beginResize(edge, pointer); });
    ipcMain.handle("mini:move-resize", (event, pointer: MiniPointer) => { validate(event); actions.moveResize(pointer); });
    ipcMain.handle("mini:end-resize", event => { validate(event); actions.endResize(); });
    ipcMain.handle("mini:state", event => { validate(event); return actions.getState(); });
    for (const action of ["preview", "endPreview", "expand", "collapse", "beginDrag", "moveDrag", "endDrag"] as const) {
        ipcMain.handle(`mini:${action}`, event => { validate(event); actions[action](); });
    }
    ipcMain.handle("mini:today", event => { validate(event); return getMiniToday(); });
    ipcMain.handle("mini:ball-menu", event => { validate(event); actions.showBallMenu(); });
    ipcMain.handle("mini:open-main", event => { validate(event); actions.openMain(); });
    ipcMain.handle("mini:start", (event, input: OccurrenceTarget) => { validate(event); const result = startOccurrence(input); actions.changed(); return result; });
    ipcMain.handle("mini:finish", (event, input: OccurrenceTarget) => { validate(event); const result = endOccurrence(input); actions.changed(); return result; });
}
