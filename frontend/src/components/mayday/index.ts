/** Componentes base del sistema de diseño Mayday. Reglas: frontend/DESIGN.md. */
export { Button, ButtonLink, GitHubIcon } from "./Button";
export { StatusChip, SceneIndex } from "./StatusChip";
export { Hud, type HudItem } from "./Hud";
export { MaydayAlert } from "./MaydayAlert";
export { Stopwatch, formatElapsed } from "./Stopwatch";
export { Logo } from "./Logo";
export { PixelTransition, createPixelSweep, fitCanvas, pixelCellPx, type PixelCell } from "./PixelTransition";
export { readToken, readPx } from "./tokens";
export { AttackTerminal, type TerminalLine } from "./AttackTerminal";
export { QuestionCard, type QuestionOption } from "./QuestionCard";
export { useReducedMotion } from "./useReducedMotion";
export { ResultSplit } from "./ResultSplit";
export { Browser, SimWindow, DeployLogs, SystemToast, TrafficLights, type DeployLogRow, type LogLevel } from "./SimApps";
