// Íconos pixel de Hinty (DESIGN.md › Hinty › 1). Mapas de letras: cada letra es un pixel.
// Se dibujan siempre a escala entera (16, 32 o 48 px) con shape-rendering crispEdges.

// Audífono de torre de control. C cuerpo · H borde de luz · M punta del micrófono.
export const HEADSET = [
  '................',
  '.....HHHHHH.....',
  '...CCCCCCCCCC...',
  '..CCC......CCC..',
  '..CC........CC..',
  '.CC..........CC.',
  'HCCC........HCCC',
  'CCCC........CCCC',
  'CCCC........CCCC',
  'CCCC........CCCC',
  '.CCC........CCC.',
  '..C.............',
  '..C.............',
  '..CC............',
  '...CCCCC........',
  '.......MMM......',
];
export const HEADSET_COLORS = { C: '#2EE6FF', H: '#7FF0FF', M: '#2EE6FF' };
// Sobre el tile cian todas las letras van en on-defense.
export const ON_DEFENSE = '#021216';

// Micrófono para el botón de hablar de la barra de Hinty.
export const MIC = [
  '................',
  '......MMMM......',
  '.....MMMMMM.....',
  '.....MMMMMM.....',
  '.....MMMMMM.....',
  '.....MMMMMM.....',
  '..M..MMMMMM..M..',
  '..M..MMMMMM..M..',
  '..M...MMMM...M..',
  '...M........M...',
  '....MMMMMMMM....',
  '.......MM.......',
  '.......MM.......',
  '.....MMMMMM.....',
  '................',
  '................',
];

// Lápiz para el botón de marcar la pantalla.
export const PENCIL = [
  '................',
  '............PP..',
  '...........PPPP.',
  '..........P.PPP.',
  '.........PPP.P..',
  '........PPPPP...',
  '.......PPPPP....',
  '......PPPPP.....',
  '.....PPPPP......',
  '....PPPPP.......',
  '...PPPPP........',
  '..PPPP..........',
  '..PPP...........',
  '..PP............',
  '................',
  '................',
];

// Check de 8×8 para las conclusiones (reemplaza al ✓ de texto).
export const CHECK = [
  '........',
  '......CC',
  '.....CC.',
  'C...CC..',
  'CC.CC...',
  '.CCC....',
  '..C.....',
  '........',
];

// Junta los pixeles seguidos de una fila y del mismo color en un solo rect.
export function pixelRuns(map) {
  const runs = [];
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x];
      let w = 1;
      while (c !== '.' && row[x + w] === c) w++;
      if (c !== '.') runs.push({ x, y, w, c });
      x += w;
    }
  });
  return runs;
}

function pixelSvg(map, colors, size, { cls = {}, defs = '' } = {}) {
  const n = map.length;
  const rects = pixelRuns(map)
    .map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1" fill="${colors[r.c]}"${cls[r.c] ? ` class="${cls[r.c]}"` : ''}/>`)
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true">${defs}${rects}</svg>`;
}

// `mic`: marca la punta del micrófono con la clase "m" para que se encienda cuando Hinty habla.
export function headsetSvg(size = 16, { mic = false, dark = false } = {}) {
  const colors = dark ? { C: ON_DEFENSE, H: ON_DEFENSE, M: ON_DEFENSE } : HEADSET_COLORS;
  return pixelSvg(HEADSET, colors, size, mic ? { cls: { M: 'm' } } : {});
}

// Va con fill currentColor para que el botón cambie de color según el estado.
export function micSvg(size = 16) {
  return pixelSvg(MIC, { M: 'currentColor' }, size);
}

export function pencilSvg(size = 16) {
  return pixelSvg(PENCIL, { P: 'currentColor' }, size);
}

export function checkSvg(size = 16) {
  return pixelSvg(CHECK, { C: '#2EE6FF' }, size);
}

// Componentes de la pizarra (node.icon): con qué se arma una arquitectura de seguridad. Una sola letra
// (X) que se pinta con currentColor, así cada ícono toma el color de su caja (ataque, defensa, clave).
// La lista de nombres es la misma que valida el backend (protocol.ts › NODE_ICONS).
export const NODE_ICONS = {
  user: [
    '................',
    '......XXXX......',
    '.....XXXXXX.....',
    '.....XXXXXX.....',
    '.....XXXXXX.....',
    '.....XXXXXX.....',
    '......XXXX......',
    '................',
    '....XXXXXXXX....',
    '...XXXXXXXXXX...',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '................',
    '................',
  ],
  attacker: [
    '................',
    '.....XXXXXX.....',
    '....XXXXXXXX....',
    '...XXXXXXXXXX...',
    '...XXX....XXX...',
    '...XX.X..X.XX...',
    '...XX......XX...',
    '...XXX....XXX...',
    '....XXXXXXXX....',
    '...XXXXXXXXXX...',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '................',
    '................',
  ],
  browser: [
    '................',
    '.XXXXXXXXXXXXXX.',
    '.X............X.',
    '.X.XX.XX.XX...X.',
    '.X............X.',
    '.XXXXXXXXXXXXXX.',
    '.X............X.',
    '.X.XXXXXXXX...X.',
    '.X............X.',
    '.X.XXXXXXXXXX.X.',
    '.X............X.',
    '.X.XXXXX......X.',
    '.X............X.',
    '.XXXXXXXXXXXXXX.',
    '................',
    '................',
  ],
  internet: [
    '................',
    '.....XXXXXX.....',
    '...XX..XX..XX...',
    '..X...X..X...X..',
    '.X...X....X...X.',
    '.XXXXXXXXXXXXXX.',
    '.X...X....X...X.',
    '.X...X....X...X.',
    '.XXXXXXXXXXXXXX.',
    '.X...X....X...X.',
    '..X...X..X...X..',
    '...XX..XX..XX...',
    '.....XXXXXX.....',
    '................',
    '................',
    '................',
  ],
  cloud: [
    '................',
    '................',
    '................',
    '......XXXX......',
    '.....X....X.....',
    '..XXX......X....',
    '.X..........XX..',
    '.X............X.',
    'X..............X',
    'X..............X',
    'X..............X',
    '.X............X.',
    '..XXXXXXXXXXXX..',
    '................',
    '................',
    '................',
  ],
  server: [
    '................',
    '..XXXXXXXXXXXX..',
    '..X..........X..',
    '..X.XX....XX.X..',
    '..X..........X..',
    '..XXXXXXXXXXXX..',
    '..X..........X..',
    '..X.XX....XX.X..',
    '..X..........X..',
    '..XXXXXXXXXXXX..',
    '..X..........X..',
    '..X.XX....XX.X..',
    '..X..........X..',
    '..XXXXXXXXXXXX..',
    '................',
    '................',
  ],
  api: [
    '................',
    '.....XX..XX.....',
    '....XX....XX....',
    '....X......X....',
    '....X......X....',
    '....X......X....',
    '...XX......XX...',
    '..XX........XX..',
    '...XX......XX...',
    '....X......X....',
    '....X......X....',
    '....X......X....',
    '....XX....XX....',
    '.....XX..XX.....',
    '................',
    '................',
  ],
  db: [
    '................',
    '.....XXXXXX.....',
    '...XX......XX...',
    '..X..........X..',
    '..XX........XX..',
    '..X.XXXXXXXX.X..',
    '..X..........X..',
    '..XX........XX..',
    '..X.XXXXXXXX.X..',
    '..X..........X..',
    '..XX........XX..',
    '..X.XXXXXXXX.X..',
    '..X..........X..',
    '...XX......XX...',
    '.....XXXXXX.....',
    '................',
  ],
  code: [
    '................',
    '................',
    '................',
    '.........X......',
    '.........X......',
    '...XX...X..XX...',
    '..XX....X...XX..',
    '.XX....X.....XX.',
    '..XX...X....XX..',
    '...XX..X...XX...',
    '......X.........',
    '......X.........',
    '................',
    '................',
    '................',
    '................',
  ],
  repo: [
    '................',
    '..XX.......XX...',
    '.X..X.....X..X..',
    '.X..X.....X..X..',
    '..XX.......XX...',
    '..X.........X...',
    '..X........X....',
    '..X......XX.....',
    '..X....XX.......',
    '..X..XX.........',
    '..XXX...........',
    '..XX............',
    '.X..X...........',
    '.X..X...........',
    '..XX............',
    '................',
  ],
  key: [
    '................',
    '................',
    '................',
    '..XXXX..........',
    '.X....X.........',
    'X..XX..X........',
    'X..XX..XXXXXXXXX',
    'X......XXXXXXXXX',
    '.X....X....XX.XX',
    '..XXXX.....XX.XX',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  secret: [
    '................',
    '................',
    '................',
    '.XXXXXXXXXXXXXX.',
    '.X............X.',
    '.X............X.',
    '.X.XX.XX.XX.X.X.',
    '.X.XX.XX.XX.X.X.',
    '.X..........X.X.',
    '.X............X.',
    '.XXXXXXXXXXXXXX.',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  token: [
    '................',
    '................',
    '.XXXXXXXXXXXXXX.',
    '.X............X.',
    '.X.XXX..XXXXX.X.',
    '.X.XXX........X.',
    '.X.XXX..XXX...X.',
    '.X............X.',
    '.X.XXXXXXXXXX.X.',
    '.X............X.',
    '.X.XXXXXX.....X.',
    '.X............X.',
    '.XXXXXXXXXXXXXX.',
    '................',
    '................',
    '................',
  ],
  lock: [
    '................',
    '.....XXXXXX.....',
    '....XX....XX....',
    '....X......X....',
    '....X......X....',
    '....X......X....',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '..XXXXX..XXXXX..',
    '..XXXXX..XXXXX..',
    '..XXXXXX.XXXXX..',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '..XXXXXXXXXXXX..',
    '................',
    '................',
  ],
  shield: [
    '................',
    '.......XX.......',
    '.....XX..XX.....',
    '...XX......XX...',
    '..X..........X..',
    '..X..........X..',
    '..X.......XX.X..',
    '..X......XX..X..',
    '..X.XX..XX...X..',
    '..X..XXXX....X..',
    '...X..XX....X...',
    '...X.......X....',
    '....X.....X.....',
    '.....XX..X......',
    '.......XX.......',
    '................',
  ],
  log: [
    '................',
    '..XXXXXXXXX.....',
    '..X.......XX....',
    '..X.......X.X...',
    '..X.......XXXX..',
    '..X.XXXXXX...X..',
    '..X..........X..',
    '..X.XXXXXXXX.X..',
    '..X..........X..',
    '..X.XXXXXXXX.X..',
    '..X..........X..',
    '..X.XXXXX....X..',
    '..X..........X..',
    '..XXXXXXXXXXXX..',
    '................',
    '................',
  ],
  alert: [
    '................',
    '.......XX.......',
    '......XXXX......',
    '......X..X......',
    '.....XX..XX.....',
    '.....X.XX.X.....',
    '....XX.XX.XX....',
    '....X..XX..X....',
    '...XX..XX..XX...',
    '...X...XX...X...',
    '..XX........XX..',
    '..X....XX....X..',
    '.XX....XX....XX.',
    '.XXXXXXXXXXXXXX.',
    '................',
    '................',
  ],
  mail: [
    '................',
    '................',
    '................',
    '.XXXXXXXXXXXXXX.',
    '.XX..........XX.',
    '.X.X........X.X.',
    '.X..X......X..X.',
    '.X...X....X...X.',
    '.X....XXXX....X.',
    '.X............X.',
    '.X............X.',
    '.XXXXXXXXXXXXXX.',
    '................',
    '................',
    '................',
    '................',
  ],
};

// Ícono de componente (16 px, un pixel del mapa por pixel de pantalla); '' si no existe.
export function iconSvg(name, size = 16) {
  const map = NODE_ICONS[name];
  return map ? pixelSvg(map, { X: 'currentColor' }, size) : '';
}
