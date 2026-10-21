export interface WorkArea { x: number; y: number; width: number; height: number }

export function defaultWindowBounds(workArea: WorkArea) {
    const width = Math.max(1, Math.min(1440, workArea.width - 32));
    const height = Math.max(1, Math.min(1000, workArea.height - 32));
    return { width, height, x: workArea.x + Math.floor((workArea.width - width) / 2), y: workArea.y + Math.floor((workArea.height - height) / 2), minWidth: Math.min(760, width), minHeight: Math.min(500, height) };
}
