// Vendorizado de clicky-kit/server/protocol.mjs. Contrato modelo ↔ motor de dibujo: el prompt
// se genera desde MARKS y cada respuesta se valida contra él, así el modelo nunca manda código.
export const MARKS: Record<string, { use: string; shape: string }> = {
  spotlight: {
    use: 'oscurece la pantalla y deja visible solo el elemento (úsalo al inicio para enfocar)',
    shape: '{"type":"spotlight","target":ID}',
  },
  ring: {
    use: 'encierra UNA cosa: una celda, un botón, una palabra',
    shape: '{"type":"ring","target":ID,"label":"máx 3 palabras"}',
  },
  frame: {
    use: 'marca una ZONA: una fila, un panel, un grupo',
    shape: '{"type":"frame","target":ID,"label":"máx 3 palabras"}',
  },
  highlight: {
    use: 'pasa destacador sobre un texto o número',
    shape: '{"type":"highlight","target":ID}',
  },
  underline: {
    use: 'subraya un texto',
    shape: '{"type":"underline","target":ID}',
  },
  num: {
    use: 'número de paso al lado de algo',
    shape: '{"type":"num","target":ID,"n":1}',
  },
  arrow: {
    use: 'flecha entre dos elementos',
    shape: '{"type":"arrow","from":ID,"to":ID,"label":"opcional"}',
  },
  target: {
    use: 'anillo que late: "haz clic aquí" para el siguiente paso del usuario',
    shape: '{"type":"target","target":ID,"label":"máx 3 palabras"}',
  },
  chart: {
    use: 'gráfico de barras dibujado a mano con datos de la pantalla; marca la barra clave',
    shape:
      '{"type":"chart","title":"Ventas Q3 por región","subtitle":"opcional","bars":[{"label":"Norte","value":131}],"highlight":"Sur","note":"+32 %"}',
  },
  board: {
    use: 'abre una pizarra en blanco para explicar un proceso o una causa dibujándolo de a poco; define su grilla de cols × rows celdas (máx 4 × 3)',
    shape:
      '{"type":"board","title":"Cómo funciona un token","subtitle":"opcional","cols":3,"rows":2}',
  },
  node: {
    use: 'una caja en la pizarra, en la celda col,row (desde 0); se dibuja cuando la nombras',
    shape:
      '{"type":"node","id":"login","text":"máx 4 palabras","col":0,"row":0,"hot":false}',
  },
  edge: {
    use: 'una flecha entre dos cajas que ya están en la pizarra, con un verbo corto',
    shape: '{"type":"edge","from":"login","to":"token","label":"entrega"}',
  },
  card: {
    use: 'tarjeta resumen con 2 a 4 líneas',
    shape:
      '{"type":"card","eyebrow":"opcional","title":"la idea en una frase","items":["línea corta"]}',
  },
  note: {
    use: 'nota adhesiva con un consejo',
    shape: '{"type":"note","text":"máx 12 palabras"}',
  },
  button: {
    use: 'botón con la siguiente pregunta probable',
    shape: '{"type":"button","text":"pregunta corta"}',
  },
};

const str = (v: unknown, n: number) =>
  (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
    .trim()
    .slice(0, n);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

export type Mark = Record<string, any> & { type: string };
export type Beat = { say: string; marks: Mark[] };

function cleanMark(m: any, ids: Set<string>): Mark | null {
  if (!m || !MARKS[m.type]) return null;
  if (m.type === 'board' || m.type === 'node' || m.type === 'edge')
    return { type: m.type };
  const needsTarget = [
    'spotlight',
    'ring',
    'frame',
    'highlight',
    'underline',
    'num',
    'target',
  ];
  if (needsTarget.includes(m.type)) {
    if (!ids.has(m.target)) return null;
    return {
      type: m.type,
      target: m.target,
      label: m.label ? str(m.label, 32) : undefined,
      n: m.type === 'num' ? (num(m.n) ?? 1) : undefined,
    };
  }
  switch (m.type) {
    case 'arrow':
      return ids.has(m.from) && ids.has(m.to) && m.from !== m.to
        ? {
            type: 'arrow',
            from: m.from,
            to: m.to,
            label: m.label ? str(m.label, 24) : undefined,
          }
        : null;
    case 'chart': {
      const bars = (Array.isArray(m.bars) ? m.bars : [])
        .slice(0, 8)
        .map((b: any) => ({ label: str(b?.label, 14), value: num(b?.value) }))
        .filter(
          (b: { label: string; value: number | null }) =>
            b.label && b.value != null && b.value >= 0,
        );
      return bars.length >= 2
        ? {
            type: 'chart',
            title: str(m.title, 40),
            subtitle: m.subtitle ? str(m.subtitle, 60) : undefined,
            bars,
            highlight: str(m.highlight, 14),
            note: m.note ? str(m.note, 14) : undefined,
          }
        : null;
    }
    case 'card': {
      const items = (Array.isArray(m.items) ? m.items : [])
        .slice(0, 4)
        .map((i: unknown) => str(i, 64))
        .filter(Boolean);
      return {
        type: 'card',
        eyebrow: m.eyebrow ? str(m.eyebrow, 24) : undefined,
        title: str(m.title, 60),
        items,
      };
    }
    case 'note':
      return m.text ? { type: 'note', text: str(m.text, 90) } : null;
    case 'button':
      return m.text ? { type: 'button', text: str(m.text, 48) } : null;
  }
  return null;
}

/** La pizarra que se está armando: su grilla, sus cajas y las celdas ocupadas. */
type Flow = {
  cols: number;
  rows: number;
  nodes: Set<string>;
  cells: Set<string>;
  edges: Set<string>;
};

/** Límites de una respuesta completa: se cuentan beat a beat, mientras llegan. */
export type Budget = {
  buttons: number;
  boards: number;
  cards: number;
  beats: number;
  flow: Flow | null;
};
export const newBudget = (): Budget => ({
  buttons: 0,
  boards: 0,
  cards: 0,
  beats: 0,
  flow: null,
});

const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/**
 * Las piezas de la pizarra se validan en orden, contra lo que ya está dibujado: una caja
 * necesita la pizarra abierta y una celda libre; una flecha, que sus dos cajas existan.
 * Así la pizarra se arma de a poco, beat a beat, como HeyClicky arma su dibujo línea a línea.
 */
function cleanFlowPiece(m: any, budget: Budget): Mark | null {
  if (m.type === 'board') {
    if (budget.flow || budget.boards >= 1) return null;
    budget.boards++;
    const cols = int(m.cols, 1, 4, 3),
      rows = int(m.rows, 1, 3, 2);
    budget.flow = {
      cols,
      rows,
      nodes: new Set(),
      cells: new Set(),
      edges: new Set(),
    };
    return {
      type: 'board',
      title: str(m.title, 48),
      subtitle: m.subtitle ? str(m.subtitle, 70) : undefined,
      cols,
      rows,
    };
  }
  const f = budget.flow;
  if (!f) return null;
  if (m.type === 'node') {
    const id = str(m.id, 24),
      text = str(m.text, 40);
    if (!id || !text || f.nodes.has(id) || f.nodes.size >= 8) return null;
    let col = int(m.col, 0, f.cols - 1, 0),
      row = int(m.row, 0, f.rows - 1, 0);
    if (f.cells.has(`${col},${row}`)) {
      // celda ocupada: la primera libre, en orden de lectura
      const free = Array.from({ length: f.cols * f.rows }, (_, i) => [
        i % f.cols,
        Math.floor(i / f.cols),
      ]).find(([c, r]) => !f.cells.has(`${c},${r}`));
      if (!free) return null;
      [col, row] = free;
    }
    f.nodes.add(id);
    f.cells.add(`${col},${row}`);
    return {
      type: 'node',
      id,
      text,
      col,
      row,
      hot: m.hot === true ? true : undefined,
    };
  }
  if (m.type === 'edge') {
    const from = str(m.from, 24),
      to = str(m.to, 24),
      key = `${from}>${to}`;
    if (
      !f.nodes.has(from) ||
      !f.nodes.has(to) ||
      from === to ||
      f.edges.has(key) ||
      f.edges.size >= 10
    )
      return null;
    f.edges.add(key);
    return {
      type: 'edge',
      from,
      to,
      label: m.label ? str(m.label, 18) : undefined,
    };
  }
  return null;
}

const fold = (w: string) =>
  w
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ%$]+/g, '');

/**
 * Palabra del "say" (separado por espacios, igual que el navegador) en que empieza `at`.
 * Busca la frase completa; si no está, la primera palabra que la contenga. -1 si no aparece.
 */
export function anchorWord(say: string, at: unknown): number {
  if (typeof at !== 'string' || !at.trim()) return -1;
  const words = say.split(/\s+/).map(fold);
  const want = at.split(/\s+/).map(fold).filter(Boolean);
  if (!want.length) return -1;
  for (let i = 0; i + want.length <= words.length; i++)
    if (want.every((w, k) => words[i + k] === w)) return i;
  const first = want[0];
  return words.findIndex(
    (w) => w && (w === first || (first.length >= 4 && w.includes(first))),
  );
}

/**
 * Valida un beat (lo que dice y lo que dibuja) y fija en qué palabra aparece cada marca
 * (`word`): la que nombró el modelo en `at` o, si no, repartidas a lo largo de la frase,
 * como HeyClicky reparte los trazos sobre la línea que se está diciendo.
 */
export function cleanBeat(
  b: any,
  ids: Set<string>,
  budget: Budget,
): Beat | null {
  if (typeof b?.say !== 'string' || !b.say.trim() || budget.beats >= 7)
    return null;
  const say = str(b.say, 220);
  const total = say.split(/\s+/).length;
  const raw: any[] = Array.isArray(b.marks) ? b.marks : [];
  const marks = raw
    .slice(0, 6)
    .map((m) => {
      const base = cleanMark(m, ids);
      return {
        m,
        clean:
          base && ['board', 'node', 'edge'].includes(base.type)
            ? cleanFlowPiece(m, budget)
            : base,
      };
    })
    .filter((x): x is { m: any; clean: Mark } => !!x.clean)
    .filter(({ clean }) => {
      if (clean.type === 'button') return ++budget.buttons <= 2;
      if (clean.type === 'chart') return !budget.flow && ++budget.boards <= 1;
      if (clean.type === 'card') return ++budget.cards <= 1;
      return true;
    })
    .slice(0, 4);
  budget.beats++;
  const nodeWord: Record<string, number> = {};
  return {
    say,
    marks: marks.map(({ m, clean }, k) => {
      const anchored = anchorWord(say, m.at);
      // Sin ancla: el foco va al principio, los botones al final y el resto se reparte.
      const word =
        anchored >= 0
          ? anchored
          : clean.type === 'spotlight'
            ? 0
            : clean.type === 'button'
              ? total - 1
              : Math.min(
                  total - 1,
                  Math.floor(((k + 0.5) * total) / Math.max(1, marks.length)),
                );
      // Una flecha no puede aparecer antes que las cajas que une (si se dibujan en este beat).
      const at =
        clean.type === 'edge'
          ? Math.max(word, nodeWord[clean.from] ?? 0, nodeWord[clean.to] ?? 0)
          : word;
      if (clean.type === 'node') nodeWord[clean.id] = at;
      return { ...clean, word: at };
    }),
  };
}

export function cleanLesson(plan: any, ids: Set<string>): Beat[] {
  const budget = newBudget();
  return (Array.isArray(plan?.beats) ? plan.beats : [])
    .map((b: any) => cleanBeat(b, ids, budget))
    .filter((b: Beat | null): b is Beat => !!b);
}
