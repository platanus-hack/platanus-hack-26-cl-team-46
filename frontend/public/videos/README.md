# Videos del producto

Copia los archivos aquí **con estos nombres exactos**. No hay que tocar código: si un archivo
no está, la página muestra un espacio reservado ("Video en camino") en vez de un reproductor roto.

| Capítulo | Video | Poster |
|---|---|---|
| 01 · El simulacro | `simulacro.mp4` | `simulacro.jpg` |
| 02 · Hinty | `hinty.mp4` | `hinty.jpg` |
| 03 · Los resultados | `resultados.mp4` | `resultados.jpg` |

Se usan en `/como-funciona` (componente `DemoVideo`, configurado en `src/content/videos.ts`).

## Formato recomendado

- **MP4 H.264** (con `+faststart`, así empieza a reproducir antes de bajar entero).
- **1920×1080 o 1280×720** (16:9).
- **Menos de 15 MB.**
- Sin sonido, o con sonido opcional: el video arranca solo y en silencio; el botón "Ver con sonido" lo reinicia con audio.
- Poster: un JPG del mismo tamaño (un cuadro representativo del video). Se muestra antes de reproducir y cuando el usuario pidió menos movimiento.

Para comprimir y dejarlo listo:

```bash
ffmpeg -i entrada.mov -c:v libx264 -crf 26 -preset slow -vf scale=1920:-2 -movflags +faststart -an simulacro.mp4
ffmpeg -ss 3 -i simulacro.mp4 -frames:v 1 -q:v 3 simulacro.jpg
```

(Quita `-an` si quieres conservar el audio.)
