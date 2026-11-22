// Un solo tema: mayday (DESIGN.md › Hinty › 13). Hinty es capa Mayday: cian para todo lo suyo y
// ámbar solo para señalar algo del atacante. Trazos rectos (wobble 0) de 3 px.
export const THEMES = {
  mayday: {
    label: 'Mayday',
    ink: '#DDF7FA', // texto sobre marcas y pizarra
    mark: '#2EE6FF', // ring, frame, underline, target
    arrow: '#2EE6FF',
    attack: '#FF8A00', // solo para lo del atacante, siempre punteado
    zone: '#2EE6FF', // tinte del frame; se pinta al 12 % (defense-soft)
    zoneOpacity: 0.12,
    palette: ['#2EE6FF', '#7FF0FF', '#8FA6AE', '#50687A'],
    hot: '#2EE6FF', // node hot y barra destacada
    highlighter: 'rgba(46, 230, 255, 0.25)', // con mix-blend-mode: screen
    pen: '#2EE6FF', // el blip
    line: '#50687A', // line-strong: edges que ya no se están explicando
    board: '#071116', // hinty-board: parche bajo las etiquetas de la pizarra
    glow: null, // el glow va solo en el blip (styles.css); las marcas quedan nítidas
    width: 3,
    wobble: 0,
    hatch: false,
    spotlight: 'rgba(5, 10, 13, 0.72)', // hinty-spotlight
    onDark: null, // el tema ya es oscuro: no hay colores aparte para superficies oscuras
  },
};

export const THEME_NAMES = Object.keys(THEMES);
