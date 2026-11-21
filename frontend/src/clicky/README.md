# Clicky: copiloto que ve la pantalla

Avioncito pixel abajo a la derecha (`ClickyDock`, montado en `app/layout.tsx`). Aparece solo con una **simulación en curso** (la página de la simulación avisa con `setClickySimulation`). Un clic pide compartir **esta pestaña** (`getDisplayMedia` con `preferCurrentTab`) y abre la isla arriba para preguntar escribiendo o manteniendo **espacio** para hablar. Responde con voz (ElevenLabs) y dibujando sobre la página. Otro clic lo apaga y suelta la captura.

- **Dónde aparece y cómo se ve:** `config.ts` (`routes`, `theme`, `surface`, `captureScreen`, `voice`, `context`).
- **Qué ve el modelo:** un JPEG de la pestaña (si el usuario la compartió; luz verde) y el texto de los elementos visibles. Los elementos sin `data-clicky` se etiquetan solos; para nombrar algo mejor, ponle `id` y `data-clicky="descripción corta"`. Lo que no debe mirar: `data-clicky-ignore`.
- **Servidor:** todo vive en el backend (`backend/src/clicky`): `POST /clicky/lesson` y `POST /clicky/transcribe`, con header `x-sim-id`. Las keys de OpenAI y ElevenLabs solo están ahí; el frontend no tiene ninguna.
- **Kit:** `kit/` y `public/clicky/styles.css` vienen de `clicky-kit` (front ES sin dependencias). Cambios: rutas y headers configurables, captura de pantalla, auto-etiquetado, voz del servidor con subtítulo sincronizado (`beat.audio`), isla que se abre sola (`openInput`, `caption`) y colores `onDark` para apps oscuras.

Variables y límites: ver `backend/.env.example` (sección Clicky). El micrófono y la captura de pantalla solo funcionan en `localhost` o con HTTPS.
