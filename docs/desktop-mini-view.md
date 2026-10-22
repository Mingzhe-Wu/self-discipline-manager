# Desktop floating Today view

## Interaction

Enable **Mini schedule enabled** in Settings or choose **Show Today mini view** in the Windows tray. The default is a 56px floating ball. Click it to expand the 340×480 Today panel upward, keeping its bottom aligned with the ball. Near the top of a screen, monitor fitting keeps the panel fully visible. Collapsing returns to a ball at the panel’s bottom-right corner. Drag the ball to either screen edge and release to tuck it into a 16px visible handle (the transparent native window remains 32px wide due to Windows minimum sizing, aligned to the selected screen edge). Click the handle to expand. The panel’s Hide control only collapses it to the ball. Right-click the ball or its docked handle and choose **Close floating ball** to hide the entire mini view for this session. The arrow opens/focuses the main app. Native close collapses an expanded panel and leaves a collapsed ball visible; and the tray can reopen the same window.

The panel header is draggable. Expanded windows can be resized down to 260×280 (or fit smaller monitors); the last panel dimensions are remembered separately from ball/handle dimensions. The ball uses pointer capture and a five-pixel drag threshold so moving it does not also expand it. Its category emoji represents the current running task, otherwise the next planned task. The default **Now & Next** view shows all running tasks, Next, up to three later planned tasks, and collapsed Missed and Completed sections. Completed appears below Missed, lists most recently finished records first, and its task labels open the exact occurrence Details. **Today timetable** switches to a scrollable single-day 24-hour grid with solid hourly lines and 72px per hour, initially centered around now. It includes today’s finished records and uses the main timetable’s shared display-time, cross-midnight clipping and overlap layout helpers. Cards use lifecycle colors/category emoji and open their exact occurrence Details in the main app; lifecycle Start/Finish remain in Now & Next. This view does not add schedule editing or duplicate Task Details. Start/Finish reuse the normal occurrence lifecycle; recurring tasks are not detached by these actions. Each Now/Next/Later/Missed task label is a native keyboard-accessible button that opens that occurrence’s Details directly, restoring the main window if hidden. Start/Finish are separate sibling controls and do not navigate. There is no separate Review button. Missed tasks have no lifecycle shortcut here.

## Persistence and windows

`trayMiniEnabled` is the existing persisted startup preference; hiding is not disabling it. `mini-window-state.json` in userData saves position, mode, panel dimensions and docking side without a schema change. Startup restores a docked handle, or a ball at the last panel/ball anchor. Opening the panel restores its anchored position, clamped to an available monitor's work area. Display changes also refit the window, including very small/negative-coordinate displays.

The independent BrowserWindow is frameless, transparent, user-resizable through explicit panel edge/corner grips, always-on-top and excluded from the taskbar. It retains context isolation and has no renderer Node integration. Its dedicated preload exposes Today/lifecycle and semantic mini-window operations only. Sender validation binds those handlers to the exact mini document/window; the mini page cannot call the main preload API.

On Windows, a single hidden PowerShell/Win32 observer checks the foreground window against its monitor bounds every 500ms. A foreground fullscreen application hides the mini window; leaving fullscreen restores it only if the user still wants it visible. The observer excludes desktop/taskbar windows, stops on quit, and logs an unavailable observer without preventing startup. This is foreground-fullscreen detection, not a scan of background applications on every monitor. It requires standard Windows PowerShell/Add-Type permission. No native addon or new package dependency is installed.

Closing the main app with close-to-tray disabled still quits the entire application, including the mini view.

## Code map

| File | Responsibility | Read |
| --- | --- | --- |
| `electron/window/miniWindow.ts` | Single-window controller, ball/panel/docked modes, pointer dragging, visibility intent, monitor refitting, JSON persistence and cleanup. Called by main and mini IPC. | Deep |
| `electron/window/miniGeometry.ts` | Pure bounds clamping and eight-direction resize geometry for panel/ball/handle dimensions. | Role |
| `src/components/MiniResizeGrips.tsx` | Pointer-captured edge/corner grips with matching resize cursors; main validates/clamps geometry and persists dimensions. Native resizing is disabled to avoid conflicting cursor behavior on transparent Windows windows. | Role |
| `electron/window/fullscreenObserver.ts` | Windows-only foreground fullscreen observation; returns a cleanup function. | Role |
| `electron/services/miniService.ts` | Today range and existing Task-service projection; includes running tasks spanning today. | Role |
| `electron/ipc/miniIpc.ts` | Validates mini sender, calls services/controller, broadcasts successful mutations. | Deep |
| `electron/miniPreload.ts` | Narrow miniAPI and subscriptions with no raw IPC/Electron event exposure. | Deep |
| `shared/types/mini.ts` | Today and window-mode DTOs. | Role |
| `shared/scheduling/miniSchedule.ts` | Pure Now/Next/Later/Missed ordering. | Role |
| `mini.html`, `src/mini.tsx`, `src/components/MiniView.tsx`, `src/mini.css` | Separate CSP-constrained React entry, ball drag/click, Today panel and widget styling. | Role |
| `src/components/MiniDayTimetable.tsx` | Today-only projection rendered with shared timetable geometry and independent scroll. | Role |
| `electron.vite.config.ts` | Builds both renderer HTML entries and both preloads; existing packaging includes their out files. | Role |

Task navigation passes only an OccurrenceTarget through mini:open-task. Mini Service resolves the current Task and exact projected/stored occurrence. Main focuses the primary window and sends task:open-details through its dedicated preload subscription; App opens its existing TaskDetails with that occurrence, independent of the browsed week. No progress is changed by navigation.

Task/Settings IPC handlers notify main after successful mutations. Main sends `data:changed` to the two trusted windows only. Both renderers refetch through their own API; an event carries no Task state. The mini also refreshes on focus and every 30 seconds for time-derived states, and discards stale responses. No Task data, reminder slots or recurrence rules are copied into window state.

## Verification

`tests/mini-view.cjs`: projection ordering and monitor/size recovery. `tests/mini-service.cjs`: local Today selection, including cross-day running records. `tests/security.cjs`: isolated preload surface and sender boundaries. Existing lifecycle tests cover startup/shutdown compatibility.

`node tests/windows-mini-view.cjs [optional executable]` uses an isolated userData directory. It verifies both-way task synchronization, recurring Start/Finish, independent main hide/open, native security/topmost settings, Today view switching, reduced panel size, ball/panel/docked dimensions, docking persistence across restart, tray reopen, panel close-to-collapse, native ball context-menu closing, startup preference and fullscreen hide/restore, including preserving a manual hide. Screenshots/results go to ignored `release/verification`.

Unpacked verification uses the existing Electron runtime and can bypass executable resource editing for verification only. The existing `resources/app.ico` contains PNG bytes instead of ICO bytes, which prevents normal icon editing during packaging. Repair the icon before a regular Windows release; this mini-view change does not replace that asset or generate NSIS.
