const positions: Record<string, number> = {};

export function saveScroll(key: string, pos: number): void {
    positions[key] = pos;
}

export function getScroll(key: string): number {
    return positions[key] ?? 0;
}