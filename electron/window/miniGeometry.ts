import type { WorkArea } from "./windowSizing";
import type { MiniResizeEdge } from "../../shared/types/mini";

export function resizeMiniBounds(bounds: WorkArea, edge: MiniResizeEdge, dx: number, dy: number, area: WorkArea): WorkArea {
    const clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(value, max)));
    const minWidth = Math.min(260, area.width), minHeight = Math.min(280, area.height);
    let left = bounds.x, right = bounds.x + bounds.width, top = bounds.y, bottom = bounds.y + bounds.height;
    if (edge.includes("w")) left = clamp(left + dx, Math.max(area.x, right - 800), right - minWidth);
    if (edge.includes("e")) right = clamp(right + dx, left + minWidth, Math.min(area.x + area.width, left + 800));
    if (edge.includes("n")) top = clamp(top + dy, Math.max(area.y, bottom - 1000), bottom - minHeight);
    if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight, Math.min(area.y + area.height, top + 1000));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

export const MINI_WIDTH = 340, MINI_HEIGHT = 480;

export function fitMiniBounds(position: unknown, workAreas: WorkArea[], size = { width: MINI_WIDTH, height: MINI_HEIGHT }): WorkArea {
    const { width: MINI_WIDTH, height: MINI_HEIGHT } = size;
    const areas = workAreas.filter(area => [area.x, area.y, area.width, area.height].every(Number.isSafeInteger) && area.width > 0 && area.height > 0);
    if (!areas.length) return { x: 20, y: 20, width: MINI_WIDTH, height: MINI_HEIGHT };
    const saved = position as { x?: number; y?: number } | null;
    const valid = saved && Number.isSafeInteger(saved.x) && Number.isSafeInteger(saved.y) && Math.abs(saved.x!) < 1_000_000 && Math.abs(saved.y!) < 1_000_000;
    const area = valid ? areas.reduce((best, candidate) => {
        const distance = (a: WorkArea) => Math.hypot(Math.max(a.x - saved.x!, 0, saved.x! - (a.x + a.width - Math.min(MINI_WIDTH, a.width))), Math.max(a.y - saved.y!, 0, saved.y! - (a.y + a.height - Math.min(MINI_HEIGHT, a.height))));
        return distance(candidate) < distance(best) ? candidate : best;
    }) : areas[0];
    const width = Math.min(MINI_WIDTH, area.width), height = Math.min(MINI_HEIGHT, area.height);
    return { width, height, x: Math.max(area.x, Math.min(valid ? saved.x! : area.x + area.width - width - 20, area.x + area.width - width)),
        y: Math.max(area.y, Math.min(valid ? saved.y! : area.y + 20, area.y + area.height - height)) };
}
