# Desktop interaction notes

This pass preserves Task schedules, recurrence, categories, occurrence history, reminders and the existing persistence layers. There is no database migration or installer rebuild.

## Week navigation and cards

Initial current-week display, explicit **This week** and a window-show refresh center the current local time within available scroll bounds. Centering waits for accepted week/planning data and the latest viewport measurement. Every week-navigation or window-show positioning request centers the current week on the current local time, or resets a non-current week to the top. Background data refreshes do not continuously reposition the board.

Planned stays neutral gray. In Progress has the strongest desaturated blue, border and small status accent. Finished stays readable in soft green at 82% default opacity, returning to full opacity when expanded.

The confirmed interaction remains two regions: fixed-height upper information opens Details/Edit; lower remaining area performs Start/Finish/Reset. Reset retains confirmation. The upper-right details icon is a visual hint, not an independent button. Both regions are native keyboard buttons; focusing reveals the card but does not act. Ctrl quick-add suppression, deterministic overlap layout and the 100ms expansion gate are preserved.

## Planned / Actual occurrence editor

TaskDetails uses ActualTimelineEditor for one-time tasks and selected recurring occurrences. Manual recurring corrections detach only that occurrence through the semantic correction API; normal lifecycle/history actions do not detach. See task-scheduling.md for the atomic history transfer and exclusion policy. Both bars use one epoch-based scale: earliest known start/end minus padding through latest known start/end plus padding. Padding is the greater of five minutes or 8% of the range. Planned is gray; Actual is soft blue. Unknown imported times, no actual record and unfinished actual ranges remain explicit.

Date inputs and five-minute selectors edit actual endpoints through the existing semantic occurrence API. Saved precise timestamps remain selectable and are not normalized merely by opening the view; changing one endpoint preserves the other exactly. Dates allow cross-day actual records without changing planned scheduling rules.

Start/end handles preview on one shared scale. While the left mouse button stays pressed near either track edge, the endpoint advances in five-minute steps every 150ms and the shared scale expands as needed. Moving back inside stops automatic advancement. Dragging and arrow-key adjustments stay within each endpoint’s selected local calendar day, from 00:00 through 23:55; padding cannot extend the scale indefinitely. Existing precise or cross-day history is kept visible and is not rewritten automatically. Pointer release commits once; Escape, pointer cancellation and capture loss cancel without writes. Arrow keys adjust handles by five minutes. Invalid end-before-start edits are rejected in the renderer and service. Dragging constrains endpoints to a valid range. Save failures restore the previous values and show a persistent inline error; a successful save followed by a refresh failure is reported separately. Focus returns to a temporarily disabled editor control only if the user has not deliberately focused another control.

Start difference, end difference, planned duration, actual duration and duration difference are derived from the four timestamps. They are not stored. Missing actual endpoints yield unknown statistics rather than invented values. Recurring tasks also retain the existing per-occurrence History editor, which does not detach. The visual editor follows the new standalone Task after a recurring correction.

## Success feedback and deletion

ToastProvider displays compact bottom-right feedback in a manual-popover stack. Toasts use 14px text, at least 52px height and larger padding/action controls. Ordinary success entries last 2.8 seconds; each entry has its own deadline so a newer message cannot replace a pending Undo. It stays above native dialogs without making the timetable modal or moving focus. Start uses the returned actual start time; Finish derives duration; Reset/save/create/actual corrections give short success messages. Important failures remain inline rather than disappearing as toasts.

Deletion confirmation names the one-time task or entire recurring series accurately. Current deletion hides/disables the Task and stops its notifications while retaining saved occurrence rows. The wording promises stored history, not a new deleted-task browsing feature. After deletion, a five-second **Task Deleted** toast offers **Undo**. Main returns an opaque one-use token and validates its expiry; undo conditionally clears that deletion and restores the original notification flag and update timestamp. Task identity, schedule, exclusions, occurrence timing and notification slots are not rewritten. The token exists only for the running app session; restarting keeps the deletion. Undo failures remain visible until dismissed. No migration is required.

## Window restore

Main loads normal x/y/width/height and maximized state from `app.getPath("userData")/window-state.json`. Missing/corrupt data falls back safely. Valid bounds fit an available display work area; disconnected displays and display changes reposition the window. Minimum usable dimensions are 760 by 500, capped by smaller work areas. Minimize/hide/maximize do not overwrite the last normal rectangle. Normal quit after successful startup atomically saves state; fatal startup does not overwrite it. This preference file is separate from SQLite.

## Verification

- `npm test`: 148 passed, including common-scale math, precision preservation, statistics, geometry/monitor recovery and lifecycle regressions.
- `npm run lint`: passed.
- `npm run build`: passed, including renderer and Electron TypeScript checks.
- `node tests/windows-deletion-undo.cjs`: passed isolated one-time/recurring restoration, original actual timing, independent stacked Undo actions and five-second expiry.
- `node tests/windows-desktop-polish.cjs`: passed real Electron flows with an isolated userData profile, including week scrolling/recentering, selectors, drag commit/cancel, failure rollback/retry, keyboard lifecycle, toast visibility above dialogs and geometry after restart.

UI evidence is generated under ignored `release/verification/desktop-polish-*`. Verification does not access the real user profile, rebuild NSIS or claim a new installed release. Optional whole-bar dragging is not implemented; endpoint dragging is supported. The latest actual-display/recurring-editor behavior is verified by tests/actual-scheduling.cjs and tests/windows-actual-scheduling.cjs.

## Unified details and automatic information editing

Task Details now has one integrated information area rather than a separate Edit Task dialog. Name, category, schedule/notification metadata and planned/actual text share the first information card. Derived statistics occupy a separate Timing summary card. The Edit switch at the bottom right of the first card swaps task metadata text for the shared TaskForm inputs. Statistics remain computed, never independently editable. The redundant planned text is hidden while planned inputs are visible.

Inline fields autosave after 400ms without another change. Saves are serialized; typing remains enabled while a request is in flight, and a newer draft is saved after that request. Turning Edit off immediately flushes the latest draft and returns to text only after the final save succeeds. Invalid data or save failures keep editing open with a persistent inline error. There are no Save/Cancel buttons in inline mode. The existing Add Task form keeps its normal Create/Cancel actions. The sync checkbox is an editing-scope preference and does not itself detach/save a task.

Actual date/time selectors, drag handles and statistics remain mounted in both modes, with their existing independent immediate-save/detachment policy. The Edit switch does not disable them. During an individual save, conflicting writes are briefly prevented as before. Recurring metadata-only autosaves retain the selected occurrence context. Metadata controls continue using the established five-minute/same-day validation. Started/finished one-time tasks lock only schedule type, not planned date/start/end; explicit planned corrections retain actual/history/slot identity.

Verification: tests/details-edit.cjs covers the default text/switch/controls arrangement; tests/windows-details-edit.cjs verifies name/category autosave, focus retention, slow-request/latest-draft serialization, edit-off flush, invalid-input recovery and Actual editing while Edit is off, using an isolated profile.

## Current Planned vs Actual layout

The upper visual layer contains shared-scale Planned (gray) and Actual (blue) bars, plain endpoint time markers and draggable Actual handles. Planned is read-only. The lower exact-input layer contains Actual start/end selectors side by side, helper text and Clear actual times. A light divider separates the layers; selectors no longer follow or flank handles. Dragging previews both layers live and persists on release; selectors immediately update the shared timeline. Five-minute snapping, validation, cancellation and held-edge extension bounded by each endpoint's local day (00:00–23:55) remain unchanged.

History/backfill is temporarily absent from Task Details; no stored history or semantic history API was deleted. Deletion remains in a separate bottom section.

## Series editing and Ctrl guidance

Manage recurring tasks sits in the top toolbar beside Planning hours and Add Task; these three buttons share a 36px height with content-sized widths. A round question-mark button at the far right exposes the Ctrl instructions on hover, focus or click. Escape dismisses the instructions.

The recurring list opens the existing TaskForm in an Edit recurring task modal, prefilled from the series definition and recurrence clock times. Save Task updates the parent definition; Save/Cancel return to the list. Timetable Details remains occurrence-specific.

While Ctrl is held, the bottom-center label reads: "Ctrl mode active. See the instructions in the top-right corner." The non-interactive pointer hint stays visible over empty space, selected ranges and cards, and changes for start selection, end confirmation, edge targeting and active dragging. Drag hints include release-to-save and right-click-to-cancel guidance. The pointer guide remains visible and snapped to five minutes; no blur or soft-focus treatment is applied.
