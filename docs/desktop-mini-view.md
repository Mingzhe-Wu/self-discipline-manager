# Desktop floating Today view

## Interaction

Enable **Mini schedule enabled** in Settings or choose **Show Today mini view** in the Windows tray. The default is a 56px floating ball. Hover for 500ms to peek, or click to keep the panel open. Clicking expands the 340×480 Today panel upward, keeping its bottom aligned with the ball. Near the top of a screen, monitor fitting keeps the panel fully visible. Collapsing returns to a ball at the panel’s bottom-right corner. Drag the ball to either screen edge and release to tuck it into a 16px visible handle (the transparent native window remains 32px wide due to Windows minimum sizing, aligned to the selected screen edge). The handle supports the same hover preview and click-to-pin interaction. The panel’s Hide control only collapses it to the ball. Right-click the ball or its docked handle and choose **Close floating ball** to hide the entire mini view for this session. The arrow opens/focuses the main app. Native close collapses an expanded panel and leaves a collapsed ball visible; and the tray can reopen the same window.

The panel header is draggable. Expanded windows can be resized down to 260×280 (or fit smaller monitors); the last panel dimensions are remembered separately from ball/handle dimensions. The ball uses pointer capture and a five-pixel drag threshold so moving it does not also expand it. Its category emoji represents the current running task, otherwise the next planned task. The default **Now & Next** view shows all running tasks, Next, up to three later planned tasks, and collapsed Missed and Completed sections. Completed appears below Missed, lists most recently finished records first, and its task labels open the exact occurrence Details. **Today timetable** switches to a scrollable single-day 24-hour grid with solid hourly lines and 72px per hour, initially positioning NOW about one third down the visible timetable (clamped at day boundaries). It includes today’s finished records and uses the main timetable’s shared display-time, cross-midnight clipping and overlap layout helpers. Cards use lifecycle colors/category emoji and open their exact occurrence Details in the main app; lifecycle Start/Finish remain in Now & Next. This view does not add schedule editing or duplicate Task Details. Start/Finish reuse the normal occurrence lifecycle; recurring tasks are not detached by these actions. Each Now/Next/Later/Missed task label is a native keyboard-accessible button that opens that occurrence’s Details directly, restoring the main window if hidden. Start/Finish are separate sibling controls and do not navigate. There is no separate Review button. Missed tasks have no lifecycle shortcut here.

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

## Hover preview and pinned expansion

The controller still uses ball / docked / expanded modes; transient expanded previews additionally carry `preview: true`. This is window state, not Task data or a database field.

| Interaction | Result |
| --- | --- |
| Hover ball or docked tab for 500 ms | Temporarily expand without changing the saved resting anchor. |
| Move from the ball into the panel | Keep the temporary preview open; no click is required to peek. |
| Leave the complete preview for 500 ms | Restore the exact original bounds and ball/docked state. Re-entering either the ball or panel cancels dismissal. |
| Click the retained ball | Pin the panel open; leaving no longer collapses it. |
| Press inside the preview panel | Pin it before the existing control/drag action proceeds. |
| Click the ball directly before hover opens | Use the existing normal expansion. |
| Press/drag the ball, including the retained preview ball | Cancel pending hover-open and claim pointer capture immediately. An already open preview follows the ball as one window; movement beyond five pixels does not pin it. A click without movement still pins/opens normally. |
| Click Hide panel | Pointer-down first pins; the control then uses normal collapse to a ball. A controller collapse of an unpinned preview restores its original ball/tab. |
| Fullscreen suppression or entire-mini hide | Dismiss preview before hiding; preserve visibility intent. |

The preview shares the existing BrowserWindow and Task content; it does not create another window or duplicate subscriptions. Its panel reserves a 56px lower strip for the ball; a left-docked preview aligns that entry to the left. Resize grips are hidden during preview and return when pinned. Bounds still fit monitor work areas.

`previewOrigin` in `miniWindow.ts` holds the original bounds/mode/edge in memory. Saving while previewing writes that original state, so a restart does not restore a temporary preview. Pinning drops the snapshot and saves ordinary expanded state. `expand()` is idempotent when pinning a preview and keeps its current bounds. `endPreview()` is a no-op after pinning, so a stale leave timer cannot collapse a pinned panel. Renderer timers are cleared on unmount. The two validated semantic IPC methods are `mini:preview` and `mini:endPreview`; no raw IPC is exposed.

## Timetable card presentation

Content is top-aligned. Tasks shorter than 40 display minutes expand vertically to a minimum 48px (40 × 1.2px/minute) on hover or keyboard focus, revealing time/state without changing saved timestamps. A decorative top-right northeast arrow appears on hover/focus, with title space reserved. It has no pointer events or separate action: the whole native button opens exact-occurrence Details.

Current implementation caveat: Mini hover raises z-index but does not override the inline overlap width/left position. It therefore does **not** currently perform the main timetable's full-width hover expansion. Shared default overlap layout and short-card vertical expansion remain active. This documents the checked-in behavior rather than claiming the earlier horizontal-expansion request is implemented.

## Focused preview verification

`node tests/windows-mini-peek.cjs` launches Electron with an isolated ignored QA profile. It checks delayed hover preview, keeping preview open inside the panel and 500ms dismissal after leaving the full preview, leave restoration, retained-ball click pinning, pinned persistence after pointer exit, drag suppression, original JSON anchor preservation and left-docked restoration. Latest successful evidence: `release/verification/mini-peek-lZPLQp`. Six existing `mini-view.cjs` tests, TypeScript/production build and ESLint (excluding locked temporary `tests/.window-geometry-*/` directories) also passed for this change. No installer rebuild or real-profile database verification was performed.

The panel header displays current local HH:mm on its own line below the date, using the Today projection time zone. A lightweight renderer clock updates it every second without refetching Tasks or moving timetable scroll. Main and Mini initial NOW positioning share `currentTimeScrollTop`: subtract one third of the usable viewport height, then clamp to scroll bounds. Main excludes its sticky weekday header; Mini has no such header. Background clock refreshes do not reposition the timetable.

Preview dragging: the ball remains the same DOM node across collapsed/preview states to preserve pointer capture. `beginDrag` accepts a preview or docked tab. An existing preview stays expanded and moves as a unit; a collapsed tab can undock for dragging. Active dragging suppresses dismissal and new previews. Each move updates the eventual resting-ball anchor, so dismissal/restart uses the new position rather than the old snapshot. Fullscreen/hide can still cancel the gesture and dismiss the preview. The drag regression uses browser pointer events plus deterministic main-process screen coordinates because CDP input does not move the physical Windows cursor; it checks actual native bounds movement with unchanged panel dimensions, no accidental pin, restoration to the moved anchor, and hover recovery.

The retained preview ball also supports the native right-click menu. The controller distinguishes a temporary preview from a pinned expanded panel; `ballMenuOpen` prevents duplicate menus and automatic preview dismissal while the menu is active. The renderer cancels its pending leave timer without pinning the panel. Closing the floating ball still hides the whole mini window; dismissing the menu outside the preview restores its resting ball. `windows-mini-peek.cjs` verifies native context-menu creation, dismissal protection and Close floating ball.
