// Tipos de los íconos pixel de Hinty (ver icons.js).
export const HEADSET: string[];
export const HEADSET_COLORS: Record<"C" | "H" | "M", string>;
export const ON_DEFENSE: string;
export const CHECK: string[];
export function pixelRuns(map: string[]): { x: number; y: number; w: number; c: string }[];
export function headsetSvg(size?: number, options?: { mic?: boolean; dark?: boolean }): string;
export function checkSvg(size?: number): string;
