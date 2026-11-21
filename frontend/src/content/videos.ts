/**
 * Videos del producto (DemoVideo). Las rutas son fijas: para agregar un video basta con copiar
 * el archivo con ese nombre a `frontend/public/videos/` (ver el README de esa carpeta).
 * Si el archivo no está, DemoVideo muestra un espacio reservado: nunca un reproductor roto.
 */
export interface DemoVideoSource {
  id: string;
  /** Se muestra en el espacio reservado y como nombre accesible del video. */
  title: string;
  src: string;
  poster: string;
}

export const VIDEOS = {
  simulacro: {
    id: "simulacro",
    title: "Video del simulacro",
    src: "/videos/simulacro.mp4",
    poster: "/videos/simulacro.jpg",
  },
  hinty: {
    id: "hinty",
    title: "Video de Hinty",
    src: "/videos/hinty.mp4",
    poster: "/videos/hinty.jpg",
  },
  resultados: {
    id: "resultados",
    title: "Video de los resultados",
    src: "/videos/resultados.mp4",
    poster: "/videos/resultados.jpg",
  },
} satisfies Record<string, DemoVideoSource>;

export type VideoId = keyof typeof VIDEOS;
