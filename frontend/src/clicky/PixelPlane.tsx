// Avioncito de papel en pixel art, 16×16, dibujado a mano: cada letra es un pixel.
// K contorno · W ala clara · Y pliegue azul · S sombra. Para retocarlo, edita el mapa.
const MAP = [
  "...............K",
  ".............KKK",
  "...........KKWWK",
  ".........KKWWWWK",
  ".......KKWWWWWYK",
  ".....KKWWWWWWYYK",
  "...KKWWWWWWWYYK.",
  ".KKWWWWWWWWYYYK.",
  "KKKKKKKWWWYYYK..",
  ".......KWYYYYK..",
  ".......KYYYYK...",
  ".......KSYYYK...",
  ".......KSSYK....",
  ".......KSSK.....",
  ".......KSK......",
  ".......KK.......",
];
const COLORS: Record<string, string> = { K: "#000000", W: "#ffffff", Y: "#60a5fa", S: "#1d4ed8" };
const PIXELS = MAP.flatMap((row, y) => [...row].flatMap((c, x) => (COLORS[c] ? [{ x, y, fill: COLORS[c] }] : [])));

export function PixelPlane({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" className="clicky-plane-svg">
      {PIXELS.map((p) => (
        <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
      ))}
    </svg>
  );
}
