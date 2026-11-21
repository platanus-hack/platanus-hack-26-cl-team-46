// Vendorizado de clicky-kit/server/protocol.mjs. Contrato modelo ↔ motor de dibujo: el prompt
// se genera desde MARKS y cada respuesta se valida contra él, así el modelo nunca manda código.
export const MARKS: Record<string, { use: string; shape: string }> = {
  spotlight: { use: 'oscurece la pantalla y deja visible solo el elemento (úsalo al inicio para enfocar)', shape: '{"type":"spotlight","target":ID}' },
  ring: { use: 'encierra UNA cosa: una celda, un botón, una palabra', shape: '{"type":"ring","target":ID,"label":"máx 3 palabras"}' },
  frame: { use: 'marca una ZONA: una fila, un panel, un grupo', shape: '{"type":"frame","target":ID,"label":"máx 3 palabras"}' },
  highlight: { use: 'pasa destacador sobre un texto o número', shape: '{"type":"highlight","target":ID}' },
  underline: { use: 'subraya un texto', shape: '{"type":"underline","target":ID}' },
  num: { use: 'número de paso al lado de algo', shape: '{"type":"num","target":ID,"n":1}' },
  arrow: { use: 'flecha entre dos elementos', shape: '{"type":"arrow","from":ID,"to":ID,"label":"opcional"}' },
  target: { use: 'anillo que late: "haz clic aquí" para el siguiente paso del usuario', shape: '{"type":"target","target":ID,"label":"máx 3 palabras"}' },
  chart: { use: 'gráfico de barras dibujado a mano con datos de la pantalla; marca la barra clave', shape: '{"type":"chart","title":"Ventas Q3 por región","subtitle":"opcional","bars":[{"label":"Norte","value":131}],"highlight":"Sur","note":"+32 %"}' },
  diagram: { use: 'diagrama de cajas y flechas para un proceso o una causa', shape: '{"type":"diagram","title":"corto","nodes":[{"id":"a","text":"máx 4 palabras"}],"edges":[["a","b","verbo opcional"]]}' },
  card: { use: 'tarjeta resumen con 2 a 4 líneas', shape: '{"type":"card","eyebrow":"opcional","title":"la idea en una frase","items":["línea corta"]}' },
  note: { use: 'nota adhesiva con un consejo', shape: '{"type":"note","text":"máx 12 palabras"}' },
  button: { use: 'botón con la siguiente pregunta probable', shape: '{"type":"button","text":"pregunta corta"}' },
};

const str = (v: unknown, n: number) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').trim().slice(0, n);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

export type Mark = Record<string, any> & { type: string };
export type Beat = { say: string; marks: Mark[] };

function cleanMark(m: any, ids: Set<string>): Mark | null {
  if (!m || !MARKS[m.type]) return null;
  const needsTarget = ['spotlight', 'ring', 'frame', 'highlight', 'underline', 'num', 'target'];
  if (needsTarget.includes(m.type)) {
    if (!ids.has(m.target)) return null;
    return { type: m.type, target: m.target, label: m.label ? str(m.label, 32) : undefined, n: m.type === 'num' ? num(m.n) ?? 1 : undefined };
  }
  switch (m.type) {
    case 'arrow':
      return ids.has(m.from) && ids.has(m.to) && m.from !== m.to ? { type: 'arrow', from: m.from, to: m.to, label: m.label ? str(m.label, 24) : undefined } : null;
    case 'chart': {
      const bars = (Array.isArray(m.bars) ? m.bars : []).slice(0, 8).map((b: any) => ({ label: str(b?.label, 14), value: num(b?.value) })).filter((b: { label: string; value: number | null }) => b.label && b.value != null && b.value >= 0);
      return bars.length >= 2 ? { type: 'chart', title: str(m.title, 40), subtitle: m.subtitle ? str(m.subtitle, 60) : undefined, bars, highlight: str(m.highlight, 14), note: m.note ? str(m.note, 14) : undefined } : null;
    }
    case 'diagram': {
      const nodes = (Array.isArray(m.nodes) ? m.nodes : []).slice(0, 6).map((n: any, i: number) => ({ id: str(n?.id ?? i, 20), text: str(n?.text, 34) })).filter((n: { id: string; text: string }) => n.text);
      const nodeIds = new Set(nodes.map((n: { id: string }) => n.id));
      const edges = (Array.isArray(m.edges) ? m.edges : []).slice(0, 7).map((e: any) => [str(e?.[0], 20), str(e?.[1], 20), str(e?.[2], 18)]).filter(([a, b]: string[]) => nodeIds.has(a) && nodeIds.has(b) && a !== b);
      return nodes.length >= 2 ? { type: 'diagram', title: str(m.title, 40), nodes, edges } : null;
    }
    case 'card': {
      const items = (Array.isArray(m.items) ? m.items : []).slice(0, 4).map((i: unknown) => str(i, 64)).filter(Boolean);
      return { type: 'card', eyebrow: m.eyebrow ? str(m.eyebrow, 24) : undefined, title: str(m.title, 60), items };
    }
    case 'note':
      return m.text ? { type: 'note', text: str(m.text, 90) } : null;
    case 'button':
      return m.text ? { type: 'button', text: str(m.text, 48) } : null;
  }
  return null;
}

export function cleanLesson(plan: any, ids: Set<string>): Beat[] {
  const beats = (Array.isArray(plan?.beats) ? plan.beats : []).slice(0, 7);
  let buttons = 0, boards = 0, cards = 0;
  return beats
    .filter((b: any) => typeof b?.say === 'string' && b.say.trim())
    .map((b: any) => ({
      say: str(b.say, 220),
      marks: (Array.isArray(b.marks) ? b.marks : []).map((m: any) => cleanMark(m, ids)).filter((m: Mark | null): m is Mark => !!m).filter((m: Mark) => {
        if (m.type === 'button') return ++buttons <= 2;
        if (m.type === 'chart' || m.type === 'diagram') return ++boards <= 1;
        if (m.type === 'card') return ++cards <= 1;
        return true;
      }).slice(0, 4),
    }));
}
