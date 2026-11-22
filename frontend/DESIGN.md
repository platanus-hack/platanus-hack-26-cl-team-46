# DESIGN.md — Mayday

**Mayday es el simulador de vuelo para responder a un hackeo.** Un dev entrena a responder un ataque a su propio proyecto antes de que le pase de verdad. Este documento son las reglas visuales de la landing y del MVP. Lo leen las personas y los agentes que construyen en `frontend/`.

## La idea en una línea

**Ataque vs. defensa.** Todo en Mayday es de uno de los dos lados:

- **Cian (`defense`) = tú.** Tu defensa, el agente que te ayuda, tus acciones correctas, el CTA, las pistas de Mayday. Si es cian, es tuyo o está a salvo.
- **Ámbar (`attack`) = el atacante.** La alerta MAYDAY, cada evento del ataque, la evidencia que dejó y las respuestas incorrectas. Si es ámbar, algo te está pasando.

El ámbar viene del "master caution" de las cabinas de avión. Cian y ámbar también se distinguen bien con daltonismo, porque difieren en luminosidad y no solo en tono.

Nunca hay un tercer color de acento. No hay rojo ni verde para error y éxito: el error es ámbar y el éxito es cian.

## Fundamentos

**Siempre oscuro.** No existe modo claro. Fondo `bg-000` (#050A0D) y superficies `bg-100` y `bg-200`. Si algo se ve lavado en el proyector, sube el contraste del texto, nunca aclares el fondo.

**Dos capas en el MVP.** Esta es la regla más importante del producto:

| Capa | Qué es | Colores |
|---|---|---|
| **Mayday** | Lo nuestro: header del escenario, HUD, pistas, marcas de evidencia, alerta, transiciones | Azul-negros de marca (`bg-*`, `ink*`) + `defense` / `attack` |
| **Simulada** | Las apps falsas del escritorio: Chrome, el panel del agente, los logs, las notificaciones del sistema | Grises neutros `sim-*`. Tienen que verse como apps reales |

La capa simulada no usa colores de marca, salvo para marcar algo del ataque (ámbar) o una acción tuya que funcionó (cian), y siempre de forma mínima: una barra de 3px, un contorno o un fondo al 12%. La única app con contenido real es la pestaña de Chrome con la repo que conectó el usuario.

**La landing puede ser loca; el escritorio, no.** La landing es una experiencia: alerta, terminal infinita, pixeles y display gigante. El escritorio es lo más normal posible, como un computador de verdad con el fondo de pantalla del avión.

## Color

Usa siempre los tokens, nunca hex sueltos.

- Texto: `ink` (principal), `ink-muted` (secundario), `ink-faint` (labels mono y metadatos). En la capa simulada: `sim-ink`, `sim-ink-muted`, `sim-ink-faint`.
- Rellenos suaves: `defense-soft` y `attack-soft` (12% de opacidad). Rellenos opacos: `defense-deep` y `attack-deep`.
- Sobre cian sólido el texto es `on-defense`; sobre ámbar sólido, `on-attack`. Nunca blanco.
- Bordes: `line` es decorativo (divisores, ventanas) y `line-strong`, de controles (3:1).
- El semáforo de las ventanas (`sim-close`, `sim-minimize`, `sim-zoom`) solo existe en los tres puntitos.

## Tipografía

Dos familias, las dos de Vercel y nativas en Next.js (paquete `geist`):

- **Geist** para todo lo que se lee: titulares, UI, textos.
- **Geist Mono** para lo que es máquina o cabina: HUD, labels en mayúsculas, código, logs, números de escenario y cronómetros (siempre con cifras tabulares).

Escala: `display-xl` 120 / `display-lg` 72 / `heading-1` 48 / `heading-2` 32 / `heading-3` 20 / `body-lg` 18 / `body` 15 / `body-sm` 13; mono: `hud-label` 11 en mayúsculas con 0.12em de tracking / `hud-number` 40 / `code` 13 / `code-lg` 16.

- Los titulares van con tracking negativo (de -0.01 a -0.045em) y peso 600. Sin cursivas.
- Los labels mono siempre en mayúsculas y siempre cortos (3 palabras máximo).
- `display-xl` se usa una vez por pantalla y solo en la landing.

## Espacio, radios y formas

- Grilla de 4px: `space-1` 4 … `space-24` 96. Margen lateral de la landing: `space-12`.
- Radios: **lo de Mayday y lo del atacante es cuadrado** (`radius-0`: pixeles, alerta, puntitos de los chips); lo interactivo es levemente redondeado (`radius-sm` 4 y `radius-md` 8), y las ventanas simuladas usan `radius-lg` 12, como un sistema operativo real.
- El pixel es la forma de la marca: el blip del logo, el puntito de los chips y las celdas de la transición. Siempre cuadrado, nunca círculo.

## Movimiento

- **Transición de pixeles** = cambio de escena. Nada más. Celdas `pixel-lg` / `pixel-md` / `pixel-sm`, entre 500 y 700 ms (ver PixelTransition).
- **Parpadeo** (`md-blink`, 1 Hz en pasos) = algo activo del atacante: el pixel de la alerta y el chip "en ataque".
- **Flicker** (`md-flicker`) = algo comprometido: la barra de una ventana o el medidor de carga. Sutil e irregular.
- **Caída** (`md-drop`, 350 ms) = algo nuevo que llega: una notificación o una pista.
- Easing de entrada: `cubic-bezier(.2,.8,.2,1)`. Sin rebotes ni escalas exageradas.
- Todo se apaga con `prefers-reduced-motion`.
- Seguridad fotosensible: nada parpadea más de 3 veces por segundo y no hay destellos de pantalla completa en colores fuertes. Si algo "tiembla", es movimiento (`transform`), no luz.
- Ningún efecto va solo: cada efecto visual del ataque viene con un cambio de texto y una fila en los logs.

## Iconografía e imágenes

- Íconos de línea de 1.5px, cuadrados, del set Lucide (ya viene con shadcn), en la capa Mayday.
- **En la capa simulada, las apps de terceros llevan su logo real**, para que el escritorio se sienta como el de un developer de verdad: Gmail (correo), Slack (chat del equipo), Claude (panel del agente), Zendesk (soporte), teléfono (llamadas), Sentry, Datadog, PostHog, Render y GitHub (integraciones) y Google Calendar (remitente de correo). Los archivos están en `public/sim-icons/` y el mapa en `src/components/workspace/sim-icons.ts`; los avatares de las integraciones se arman en `BotAvatar`. Lo que no es una app real (la app del developer, pestañas sin URL, personas) va con una letra sobre `sim-300`.
- Los logos se usan tal cual (sin recolorear ni deformar). Si un glifo no se lee sobre gris oscuro, va en blanco sobre el color de su marca, como los avatares de `BotAvatar`.
- En la capa Mayday, los logos de terceros son el de GitHub en el botón de login y la fila de apps del simulacro (`AppLogos`, en la landing y en /como-funciona), que muestra por dónde te llega el incidente.
- Sin fotos, ilustraciones 3D, emojis decorativos ni gradientes de color. La única imagen grande es el fondo de pantalla del avión (Assets › Fondos).

## Voz y copy

Español de Chile neutro, con los términos técnicos en inglés como los dice un dev: "rota la key", "te hicieron un prompt injection", "haz el deploy".

- Frases cortas. Directo, con algo de humor, sin slang ("Bien ahí." sí; "la wea" no).
- La landing tutea y habla del usuario: "tu repo", "tu key".
- Siempre aclara que es un simulacro: nadie debe creer que lo están hackeando de verdad.
- Nunca pidas claves ni credenciales. La promesa visible es "Solo lectura. Nunca te pedimos tus claves."
- Los datos de ataque son ficticios pero verosímiles: keys truncadas (`sk-proj-9fXq…`), IPs de documentación y montos en US$.

## La landing, escena por escena

0. **Intro "te están hackeando"** (~2,5 s al abrir, una vez por sesión; `/#intro` la fuerza): en computador se abren ventanas de la capa simulada con el ataque y un cursor fantasma ámbar; en teléfono aparecen alertas de permisos del sistema (contraseñas, contactos, fotos, Face ID) que se aprietan solas con un dedo fantasma ámbar, mientras detrás se encienden esos permisos en ámbar, y bajan notificaciones. Termina con la transición de pixeles y deja el hero. Siempre con chip "Simulacro" y botón "Saltar" (clic, toque o Esc). Sin intro con `prefers-reduced-motion`.
1. **Llegada:** arranca el simulacro. MaydayAlert sólida en marquesina, el logo y el cronómetro T+00:00 que empieza a correr. Titular en `display-xl`.
2. **Scroll:** transición de pixeles a pantalla completa. Se abre la pregunta (QuestionCard) con el AttackTerminal corriendo infinito detrás.
3. **Respuesta:** eliges entre 3 opciones. Pixeles sobre el panel (`pixel-sm`) y se revela qué estaba bien (cian) y qué no (ámbar).
4. **Resultado:** pixeles a pantalla completa y ResultSplit. A la izquierda, cómo te fue y por qué; a la derecha, "Haz el simulacro con tu repo" + Entra con GitHub.

El scroll maneja las escenas (pinned sections con GSAP ScrollTrigger o Framer Motion); cada escena ocupa una pantalla.

## El escritorio (MVP)

Header del escenario arriba. Debajo, Chrome (Google + la pestaña de tu repo) a la izquierda, los logs tipo panel de deploy debajo de Chrome y el panel del agente a la derecha, de alto completo. Las notificaciones bajan arriba a la derecha. Las pistas cian y las marcas ámbar flotan encima. Ver Desktop.

Los eventos del timeline (contrato 2) se pintan siempre en dos lugares: una fila ATTACK en los logs y su efecto en la app que corresponda, según la familia:

- **A · Entrada de texto:** texto que se escribe solo en un chat o un input.
- **B · Infra y secretos:** una variable de entorno que se revela.
- **C · Volumen y caída:** el medidor de carga sube y parpadea.

## No hacer

- Gradientes azul-morado, glassmorphism, tarjetas con borde de color a la izquierda, emojis como íconos.
- Usar ámbar para algo del usuario o cian para algo del atacante.
- Teñir las apps simuladas con la marca.
- Texto "hacker" verde sobre negro: nuestro verde es cian.
- Más de dos pistas visibles a la vez.
- Animar el logo, salvo el parpadeo del pixel.


## Cómo usar esto en la repo

- Fuente de verdad visual: el sistema de diseño "Mayday" (artifact en claude.ai). Si algo de este archivo choca con el sistema, manda el sistema.
- Tokens: `frontend/src/app/mayday-tokens.css` (importar en `globals.css`). Nunca hex sueltos en componentes: usa las clases de Tailwind que salen de los tokens (`bg-bg-100`, `text-ink-muted`, `text-defense`, `bg-attack-soft`, `border-line-strong`, `rounded-lg`, `shadow-window`).
- Fuentes: paquete `geist` (`import { GeistSans } from "geist/font/sans"` y `GeistMono`), con sus variables `--font-geist-sans` y `--font-geist-mono` en el `<html>`.
- Clases de referencia: `frontend/src/app/mayday-components.css` trae el CSS exacto de cada componente (prefijo `md-`). Se puede usar directo o como spec para escribir los componentes en React.
- Animaciones: CSS para lo simple (blink, flicker, drop); Framer Motion o GSAP para las escenas de la landing y la transición de pixeles.
- Antes de hacer un PR de UI, revisa la sección "No hacer".

---

# Componentes


## Marca

### Logo

Wordmark MAYDAY en Geist SemiBold en mayúsculas, más un símbolo: dos anillos de defensa (cian) con una brecha arriba a la derecha, por donde entra el atacante (un pixel ámbar).

- El símbolo cuenta el producto completo: tu defensa, la brecha y el ataque entrando. No le agregues más elementos.
- Lockup horizontal: símbolo de alto = altura de mayúsculas × 1.5, separación = 0.4 × altura del símbolo.
- Tamaño mínimo del símbolo: 16px (favicon). Bajo 24px, el wordmark va solo, sin símbolo.
- Siempre sobre `bg-000`, `bg-100` o `bg-200`. Versión de una tinta (`ink`) solo cuando no hay color (impresión, sellos).
- No cambies los colores: cian siempre son los anillos y ámbar siempre es el pixel. Nunca rotar el símbolo ni animar los anillos; lo único que se puede animar es el pixel (parpadeo `md-blink`) cuando hay un simulacro en curso.
- Archivos en Assets › Logos: `mayday-mark.svg`, `mayday-lockup.svg`, `mayday-wordmark.svg`, `mayday-favicon.svg`, `mayday-mark-mono.svg`.


## Landing

### Button

Acción del usuario. El primario es cian sólido (`defense`) con texto `on-defense`: es tuyo, es seguro, es el siguiente paso.

- Un solo primario por pantalla. En la landing siempre es "Entra con GitHub".
- El secundario es fantasma: borde `line-strong`, sin relleno.
- No existe botón ámbar: el ámbar es del atacante, y el usuario nunca "ataca". Si una acción es destructiva (revocar una key), sigue siendo cian, porque es defensa.
- Verbo primero, en español, con mayúscula solo inicial: "Entra con GitHub", "Revoca la key".
- Tamaños: 40px (escritorio, paneles) y 52px `md-btn--lg` (landing).
- Hover del primario: `defense-strong` + `glow-defense`. Foco: anillo `focus-ring`.

### BackButton

Volver al paso anterior en la landing. Es sutil a propósito: label mono en `ink-faint` (`ink` al pasar el mouse), flecha Lucide, sin borde ni relleno, para no competir con el único primario.

- Verbo primero y corto: "Vuelve al inicio" (en la pregunta, dentro del panel junto al label) y "Revisa la pregunta" (arriba del resultado).
- Vuelve con scroll suave (las cortinas se cierran solas); con `prefers-reduced-motion`, salto directo.

### StatusChip

Etiqueta mono en mayúsculas para estados y metadatos del HUD. El cuadradito de la izquierda es un pixel, no un círculo.

- `md-chip--attack`: hay un ataque activo; el pixel parpadea.
- `md-chip--defense`: amenaza contenida o paso resuelto.
- Neutro: categoría, familia del vector, stack.
- Máximo 3 palabras. Numeración de escenas con `md-index` ("01 / 04").

### Hud

Lecturas tipo cabina en la capa Mayday: cronómetro, pasos contra el mínimo y contención. Son las dimensiones de la rúbrica.

- Valores en `hud-number` (mono, cifras tabulares) y labels en `hud-label`.
- El cronómetro del ataque va en `attack` mientras corre; los valores logrados van en `defense`; el resto, en `ink`.
- Va en el header del escenario y en el resultado. Nunca dentro de las apps simuladas.

### MaydayAlert

La llamada de auxilio. Es lo primero que ves al entrar a la landing y marca el inicio de cada simulacro en el MVP.

- Variante por defecto: banda `attack-deep` con bordes `attack` y texto `attack-strong`. Va arriba de todo, a todo el ancho, con radio 0.
- `md-alert--solid` (ámbar completo) solo en el arranque de la landing, como marquesina, y dura poco: al hacer scroll baja a la variante por defecto.
- Siempre dice que es un simulacro. Un usuario nunca debe pensar que lo están hackeando de verdad.
- El pixel de la izquierda parpadea a 1 Hz (`md-blink`). Nada más se mueve.

### AttackTerminal

El código de hackeo que corre infinito detrás de la pregunta de la landing. Es ambiente: nadie lo lee entero, pero tiene que ser verosímil.

- Texto en `code-lg`, color `ink-faint`; las líneas donde "pega" el ataque van en `attack`, y las respuestas del servidor, en `ink-muted`.
- El contenido se duplica y se desplaza hacia arriba en loop (`md-feed`, 18 s). Arriba y abajo se funde con `bg-000`.
- Siempre detrás de algo (la pregunta), nunca como protagonista. En el MVP no existe: ahí la terminal es la de logs.
- Comandos reales y creíbles (git, trufflehog, curl, nmap), pero con datos ficticios: keys truncadas, IPs de ejemplo, repos inventados.

### QuestionCard

La pregunta de la landing: un incidente en una línea, la línea de código real (o de ejemplo) y tres respuestas.

- Panel `bg-100` al 90% con blur, sobre el AttackTerminal. Título en `display-lg` reducido a 40px dentro del panel.
- La línea de código va en `code`, y lo comprometido se marca con `attack-soft` + `attack-strong`.
- Exactamente 3 opciones (A, B, C), navegables con teclado (teclas A/B/C y flechas).
- Estados de opción: normal → hover (`bg-200`) → seleccionada (borde `ink`) → al revelar: correcta en `defense`, incorrecta en `attack` y el resto atenuado (`is-dim`).
- Entre seleccionar y revelar va la transición de pixeles (`pixel-sm`) sobre el panel, unos 600 ms.
- El veredicto de cada opción es corto y en mayúsculas: "Correcto", "Tarde", "Empeora".

### ResultSplit

El cierre de la landing: a la izquierda, cómo te fue; a la derecha, la invitación a simular con tu repo.

- Pantalla dividida al 50/50. La izquierda queda en `bg-000` y la derecha en `bg-100`, separadas por un hairline `line`.
- Veredicto en `display-lg`: cian si acertaste ("Bien ahí."), ámbar si no ("Te hackearon."). El texto explica en 2 frases por qué y termina con la pregunta que lleva a la derecha.
- La derecha siempre es igual: título, promesa de seguridad (solo lectura, sin claves) y el único botón primario.
- Aparece con la transición de pixeles a pantalla completa (`pixel-lg`).

### PixelTransition

Separa escenas. La pantalla se llena de pixeles cuadrados de `bg-000` de izquierda a derecha (con algo de azar), y el borde que avanza va en `defense`. Después se vacía en el mismo orden y deja ver la escena nueva.

- Es solo transición. No significa ataque ni daño; para eso están el ámbar y el parpadeo.
- Celdas: `pixel-lg` (32px) a pantalla completa en desktop, `pixel-md` (16px) en mobile, `pixel-sm` (8px) dentro de un panel.
- Duración: 500–700 ms en total (entra + sale), con el cambio de contenido en el punto medio, cuando la pantalla está tapada.
- Dónde: entre escenas de la landing (hero → pregunta → resultado) y en el MVP al pasar de un escenario a otro. Nunca dentro de una app simulada.
- Implementación: grilla de divs o un canvas; un orden precalculado por columna + ruido; `prefers-reduced-motion` = corte directo.


## Escritorio (MVP)

### ScenarioHeader

Capa Mayday, arriba del escritorio. Dice qué escenario corre, de qué se trata y cuánto tiempo llevas.

- Número del escenario en mono 64px y en `attack`; título en 28px y bajada de una frase en `ink-muted`.
- A la derecha, chips: estado (`En ataque` / `Contenido`), la familia del vector y el cronómetro.
- Es lo único con color de marca fuera de las pistas. Todo lo de abajo es la capa simulada.

### Hint y Evidence

Las dos marcas que la capa Mayday pone encima de las apps simuladas.

**Hint (`md-hint`)**: una pista numerada, en cian sólido con texto `on-defense`. Cian, porque es ayuda: es Mayday de tu lado.
- Máximo 2 visibles a la vez, numeradas en el orden en que conviene leerlas.
- Una frase de menos de 12 palabras. Aparece con `md-drop`, cerca del elemento al que apunta, sin taparlo.
- Se muestran cuando el usuario se traba (tiempo sin acciones) o al revisar el resultado. No al inicio.

**Evidence (`md-evidence`)**: contorno ámbar de 2px alrededor del rastro del atacante dentro de una app simulada (una línea, un monto, una fila).
- Ámbar, porque es el atacante. `--pulse` solo en la evidencia más importante.
- Nunca rellena ni cambia el contenido de la app: la app sigue viéndose real.

### Browser

Capa simulada. Un navegador tipo Chrome en modo oscuro: semáforo de macOS, pestañas, barra de navegación y omnibox. Es la ÚNICA app con contenido real: una pestaña muestra el archivo de la repo que conectó el usuario, con las líneas reales que encontró el análisis.

- Grises neutros `sim-*`, nunca los azul-negros de la marca. Tiene que parecer Chrome, no Mayday.
- Pestañas: "Google" (decorativa) + la pestaña de la repo, activa, con la ruta real del archivo. Se pueden sumar pestañas que el escenario necesite (el dashboard del proveedor, el correo), siempre simples.
- La línea comprometida se marca con fondo `attack-soft` y una barra ámbar de 3px en el número de línea. El resto del código se ve como en GitHub.
- Pestañas de apps de terceros con su logo real (Gmail, Slack); las demás, una letra sobre `sim-300`.
- Cuando el atacante toca el navegador: `is-compromised` (glow ámbar), más un cambio de contenido que lo explique.

### AgentPanel

Capa simulada. El chat con el agente de respuesta a incidentes, a la derecha del escritorio, de alto completo. El usuario le escribe para que lo ayude o resuelve a mano en el navegador.

- **La IA viene integrada en Mayday.** El usuario no conecta su propio Claude ni ninguna cuenta de IA: el agente ya está en el simulacro. No lo digas de otra forma en ningún copy ("conecta tu Claude", "tu agente de código", etc.).
- Grises `sim-*`. Header con la mascota pixel animada de Claude Code, el nombre "Claude" y el contexto (el nombre del proyecto). El logo de Claude va en el estado vacío del chat.
- Mensajes del usuario en burbuja `sim-200` a la derecha. Las respuestas del agente van sin burbuja: texto plano con negritas, secciones en mono mayúscula ("AHORA · PRIMEROS 5 MINUTOS") y pasos numerados.
- No uses colores de marca adentro. Si el agente sugiere algo correcto, se nota en los logs (fila OK), no en el chat.
- Composer abajo, con placeholder "Escríbele a Claude…" y botón de enviar.
- El logo de Claude es el único color de marca permitido en el panel; los mensajes siguen en grises `sim-*`.

### DeployLogs

Capa simulada, abajo del navegador. Se ve como el panel de logs de un servicio de deploy: pestañas (Build / Deploy / Network), filtro, columnas Time y Data, y filas en mono con una barra de color a la izquierda. Es por donde avanza el ataque y por donde Mayday te da hints y te muestra tu progreso.

| Nivel | Barra | Fondo | Para qué |
|---|---|---|---|
| `INFO` | ninguna | — | Tráfico normal de la app. Da realismo. |
| `WARN` | `sim-ink-faint` | — | Señales previas al ataque (billing, rate limit). |
| `ATTACK` | `attack` | `attack-soft` | Cada evento del timeline del atacante. |
| `MAYDAY` | `defense` | — | Hint de Mayday escrito como log. |
| `OK` | `defense` | `defense-soft` | Una acción tuya que contuvo algo. |

- Las filas entran de a una desde abajo, al ritmo del timeline; la última línea tiene cursor.
- Datos ficticios pero verosímiles: rutas reales de la app del usuario, IPs de documentación, montos.
- Los eventos del contrato 2 (evento de simulacro) se pintan aquí como filas ATTACK, y además disparan su efecto visual en el navegador o en una notificación.

### SystemToast

Capa simulada. Notificación del sistema operativo que baja en la esquina superior derecha del escritorio: correo, Slack, alertas del proveedor.

- Se ve como una notificación de macOS en oscuro: `sim-200`, radio `radius-lg`, app y hora arriba, título y una línea.
- Entra con `md-drop` (350 ms). Máximo 3 apiladas; la más vieja se va.
- Si la notificación es parte del ataque (phishing, un deploy que no hiciste), lleva `is-attack`: contorno ámbar. El contenido sigue siendo realista.

### VectorFamilies

Cómo se ve cada familia de ataque dentro de las apps simuladas. Los efectos son sutiles: un texto que se escribe solo, un valor que se revela, un medidor que sube y parpadea.

- **A · Entrada de texto** (prompt injection, mensaje): el texto malicioso aparece escribiéndose (`md-injected`) en un input o chat, con fondo `attack-soft`.
- **B · Infra y secretos** (deploy, acceso a llavero): una variable de entorno se revela y queda con glow ámbar (`md-secret.is-leaked`). La credencial siempre es ficticia.
- **C · Volumen y caída** (DoS): el medidor de carga sube; las barras críticas pasan a `attack` y parpadean (`md-flicker`).
- Cadena narrativa: A → B → C (entrada → escalada → impacto). Cada paso deja una fila ATTACK en los logs.
- Regla de oro: el efecto nunca va solo. Siempre lo acompaña un cambio de texto y una fila de log, para que se entienda sin depender del color.

### Desktop

La composición completa del MVP: un escritorio lo más normal posible, con el fondo de pantalla del avión (Assets › Fondos), y encima tres apps simuladas y la capa Mayday.

```
┌──────────────────────────── ScenarioHeader (capa Mayday) ────────────────────────────┐
├───────────────────────────────────────────────────────┬──────────────────────────────┤
│ Browser (Chrome: Google + pestaña de TU repo)         │ AgentPanel (agente integrado) │
│                                                       │                              │
├───────────────────────────────────────────────────────┤                              │
│ DeployLogs (ataque, hints, progreso)                  │                              │
└───────────────────────────────────────────────────────┴──────────────────────────────┘
  SystemToast baja arriba a la derecha de la pantalla · Hint y Evidence flotan encima
```

- Grilla: columna principal flexible + 360px para el agente; filas: header, navegador (flexible), logs (300px). Gap `space-4`.
- Las ventanas no se mueven ni se redimensionan en la demo: es teatro guiado, no un sistema operativo.
- El fondo de pantalla se ve en los bordes y entre ventanas; nunca se le pone nada encima.
- Pantalla objetivo: 1440 × 900 (proyector). Bajo 1280 px de ancho, el agente pasa abajo de los logs.

## Hinty

Hinty es el profesor dentro del simulacro: te explica hablando y dibujando sobre la pantalla, y al final te entrega el reporte. Su figura es **la torre de control**: Mayday es tu llamada de auxilio y Hinty es quien te contesta y te guía hasta aterrizar.

Esta sección solo cambia el diseño. La funcionalidad, el protocolo, las rutas `/clicky/*`, las clases `clicky-*` y los atributos `data-clicky` no se tocan.

### 1. Identidad

- **Capa:** Hinty vive en la **capa Mayday**: fondos `bg-*`, texto `ink*`, acento `defense` (cian) y Geist / Geist Mono. Nunca usa los grises `sim-*`; eso es lo que lo separa del panel del Agente.
- **Color:** cian `defense` #2EE6FF. Hinty es ayuda, y la ayuda en Mayday es cian.
- **Ícono:** un audífono de torre de control en pixel art de 16×16. Reemplaza al avión de papel de `PixelPlane.tsx`, con la misma forma de mapa de letras:

```ts
// Audífono de Hinty: mismo formato que PixelPlane.tsx
const HINTY_HEADSET = [
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
const HINTY_PALETTE = {
  C: '#2EE6FF', // cuerpo (defense)
  H: '#7FF0FF', // borde de luz (defense-strong)
  M: '#2EE6FF', // punta del micrófono: pasa a #7FF0FF + glow cuando Hinty habla
};
// Sobre un fondo cian (tile), todas las letras van en #021216 (on-defense).
```

- Se dibuja siempre a escala entera (16, 32 o 48 px) con `shape-rendering: crispEdges` o `image-rendering: pixelated`. Nunca 24 px: queda borroso.
- Archivos: `hinty-headset.svg` (cian) y `hinty-headset-dark.svg` (para el tile cian).

### 2. Botón del dock

Un tile cuadrado de **56×56 px**, `radius-md` (8 px), con el ícono a 32 px (2 px por pixel) al centro. Al lado tiene una etiqueta de texto que aparece en hover, en el foco o en la primera visita.

| Estado | Fondo | Borde | Ícono | Pixel de estado | Etiqueta |
|---|---|---|---|---|---|
| Apagado | `bg-100` | 1 px `line-strong` | cian | — | "¿Te trabaste? Pregúntale a Hinty" |
| Hover | `bg-200` | 1 px cian al 60% | cian | — | "Activa a Hinty: te explica lo que ves en pantalla" |
| Active (presionado) | `bg-300` | 1 px cian | cian, `translateY(1px)` | — | — |
| Focus | igual al estado actual | + `focus-ring` (2 px de separación, 2 px cian) | — | — | — |
| Activando | `bg-100` | 1 px cian | cian; una línea de escaneo de 2 px cian baja por el tile (600 ms, en loop) | — | "Conectando con Hinty…" |
| Encendido, ve la pantalla | `defense-deep` | 2 px cian + `glow-defense` | cian | cuadrado de 6×6 cian **lleno**, fijo, en la esquina superior derecha | "Hinty ve tu pantalla" |
| Encendido, solo texto | `defense-deep` | 2 px cian | cian | cuadrado de 6×6 **vacío** (borde de 1,5 px cian), fijo | "Hinty lee solo el texto" |
| Simulación terminada | `bg-100` | 1 px cian | cian | — | "Repasa el simulacro con Hinty" |

- **Luz verde y ámbar:** se reemplazan por el pixel de estado. La diferencia está en la forma (lleno o vacío), no en el color: no hay verde y el ámbar es del atacante.
- **Sombra:** `shadow-toast`. Nada de sombra dura de 4 px.
- **Al encenderse:** en vez de la estela, sale **un solo pulso de radio**: un cuadrado de borde cian de 1 px que crece desde el tile hasta 1,15× y se desvanece en 400 ms. Se reproduce una vez, no en loop.
- **Etiqueta:** Geist 13 px, `ink`, sobre `bg-100`, con borde 1 px `line` y `radius-sm`. Sale Silkscreen.
- **Ubicación:** abajo a la derecha de la **columna principal** (Chrome + logs), a 16 px del borde del panel de logs. Nunca encima del panel del Agente (ver punto 11).

### 3. Barra de arriba

- **Forma:** una barra de borde a borde que **baja desde arriba** (320 ms) y se pone **encima del header** mientras Hinty está activo. Mide **lo mismo que el header** (la página lo marca con `data-clicky-region="header"`; 64 px si no hay), así nunca tapa las apps de abajo. No crece: si el subtítulo es largo, quedan a la vista sus últimas 2 líneas.
- **Fondo:** **todo cian** (`defense`), con borde inferior 2 px `defense-strong` y un glow cian hacia abajo. El texto va en `on-defense`. Tiene que ser imposible no notar que estás hablando con Hinty.
- **Marco de pantalla:** mientras Hinty está activo, los bordes de la ventana llevan un marco cian de 4 px con un brillo cian hacia adentro. No sale en la captura que ve el modelo.
- **Avatar:** un tile cuadrado de 40 px en `on-defense` y `radius-sm`, con el audífono cian a 16 px.
- **Escuchando / hablando:** 5 barras cuadradas de 4 px de ancho con 2 px de separación, en `on-defense`. Las alturas van en pasos de 4 px (de 4 a 20). Hablando, la punta del micrófono del avatar se enciende (#7FF0FF + glow).
- **Pensando:** 3 pixeles cuadrados de 4×4 en fila que se encienden en `on-defense` uno tras otro, en un ciclo de 900 ms.
- **Subtítulo palabra por palabra:** Geist 15 px en `on-defense`, **centrado** en la barra (en alto y en ancho), en un bloque de un poco más de media pantalla (58vw). La palabra que se acaba de decir va en un bloque negro con letra cian. Las palabras que faltan no se muestran.
- **Input:** **negro**, 44 px de alto, `radius-md`, Geist 16 px en `ink`, cursor cian y placeholder en `ink-faint`.
- **Botón de hablar:** la única pieza redonda de Hinty, junto con el lápiz. Un círculo de 44 px (el mismo alto que el input) en `on-defense` con un micrófono pixel cian, y un halo que respira cada 2,4 s para invitar a apretarlo. Mantenerlo apretado = hablar mientras está apretado; un clic corto lo deja escuchando hasta el siguiente clic. También se habla manteniendo **fn** (funciona aunque el foco esté en el input, porque fn no escribe). Escuchando, se invierte a blanco con ondas que salen. No hay atajos escritos en la barra: al pasar el cursor baja una nube negra con borde cian que los explica.
- **Lápiz (modo marcar):** siempre a la derecha del micrófono, del mismo tamaño. Un clic enciende el modo marcar (el lápiz queda en blanco); encendido no dibuja solo: se dibuja **manteniendo shift** y moviendo el cursor (el cursor pasa a cruz). Lo marcado va con la próxima pregunta, hablada o escrita. Otro clic lo apaga. Mantener **Control + Option** sigue sirviendo para hablar y marcar a la vez.
- **Cerrar:** una X de 32 px en `on-defense` en el extremo derecho, separada de los botones por una línea. Apaga a Hinty igual que apretar el audífono.
- **Error:** borde inferior `attack` y un pixel de 8×8 `attack` a la izquierda. El texto sigue oscuro para leerse sobre el cian. El mensaje siempre empieza con "No pude…".

### 4. Lápiz

Deja de ser un triángulo y pasa a ser **el blip del radar**: un cuadrado cian de 10×10 px con borde de 1 px `bg-000` y `glow-defense`. Mientras viaja deja el trazo detrás. Es el mismo pixel del logo Mayday, así que se lee como "la torre marcando en el radar".

### 5. Marcas sobre la pantalla

Todas las marcas de Hinty son **cian, rectas (wobble 0) y de 3 px**. Es una torre de control marcando un radar, no un plumón tembloroso: la precisión es parte de la confianza.

| Marca | Cómo se ve |
|---|---|
| `ring` | Rectángulo de 3 px cian con `radius-sm`, 6 px por fuera del elemento. No es un óvalo. |
| `frame` | Tinte cian al 12% (`defense-soft`) + borde punteado de 2 px cian (6 px de trazo, 6 px de espacio). |
| `highlight` | Cian al 25% en modo `screen` (sobre fondo oscuro, `multiply` ensucia). |
| `underline` | Línea recta de 3 px cian, 4 px debajo de la línea base. |
| `num` | Cuadrado de 24×24 px, relleno cian, número en Geist Mono 13 px / 600 en `on-defense`. Sin radio. |
| `arrow` | Línea recta de 3 px cian con codos a 90° y una punta triangular sólida de 10 px. |
| `target` | Cuatro esquinas de mira (⌜ ⌝ ⌞ ⌟) de 3 px cian alrededor del elemento, como el "lock-on" de un HUD. Laten de 1 a 1,08× cada 1,2 s. Debajo va la etiqueta "Haz clic aquí". |
| `spotlight` | Todo se oscurece con `bg-000` al 72%, salvo un hueco con `radius-md` y un borde de 2 px cian. |
| Etiquetas (píldoras) | Rectángulos `radius-sm`, fondo cian, texto Geist 13 px / 500 en `on-defense`, 4×8 px de padding. Ya no son de 999 px. |

**Cómo se distinguen de las otras marcas de Mayday:**
- **`md-hint` pasa a ser parte de Hinty.** Las pistas numeradas en cian *son* el `num` + etiqueta de Hinty: un solo lenguaje, no dos. El nombre se ordena así: **Hinty** es el profesor y una **pista** (`md-hint`) es lo que Hinty deja en la pantalla.
- **Máximo de 2:** cuenta para los pines numerados que quedan fijos en pantalla. Mientras Hinty está explicando, los dibujos de esa explicación no cuentan, pero hay **una sola explicación a la vez**, y al empezar una se ocultan las pistas fijas.
- **`md-evidence`** (contorno ámbar sólido de 2 px) sigue siendo el rastro del atacante, y no lo dibuja Hinty.
- **Cuándo Hinty usa ámbar:** solo para señalar algo del atacante (una línea comprometida, un log de ataque). En ese caso, `ring`, `frame` o `arrow` van en ámbar **punteado** (6/6), nunca relleno, y siempre con una etiqueta cian al lado que lo explique. Así no se confunde con `md-evidence`, que es sólido.

### 6. Pizarra (`board` / `node` / `edge`) y `chart`

La pizarra es **la pantalla del radar de la torre**: oscura, con grilla fina, donde Hinty arma el diagrama frente a ti.

- **Fondo:** `hinty-board` (#071116) con una grilla de 24 px en `hinty-grid` (#12222A), borde 1 px `line`, `radius-lg` y `shadow-window`. Padding de 24 px.
- **Encabezado:** a la izquierda, el audífono a 16 px + "PIZARRA" en Geist Mono 11 px, en mayúsculas y `ink-faint`. Debajo, el título en Geist 20 px / 600 (`ink`) y el subtítulo en Geist 14 px (`ink-muted`).
- **Grilla de celdas:** hasta 4×3, con 24 px entre celdas, alineada a la grilla de fondo.
- **`node` normal:** fondo `bg-200`, borde 1 px `line-strong`, `radius-md`, texto Geist 15 px / 500 `ink` y padding de 10×14 px.
- **`node` `hot`:** fondo `defense-deep`, borde 2 px cian y `glow-defense`. El texto sigue en `ink`.
- **`node` del atacante** (si el contenido lo pide): fondo `attack-deep`, borde 2 px `attack` punteado y texto `attack-strong`.
- **`edge`:** líneas rectas con codos a 90°, de 2 px `line-strong`. El edge activo (el que se está explicando) va en cian, con una punta triangular de 8 px.
- **Etiqueta del `edge`:** Geist Mono 12 px `ink-muted`, sobre un parche de `hinty-board` para que la línea no la cruce.
- **Cómo se dibuja:** primero aparecen las cajas (rise de 8 px + fade, 240 ms, una tras otra cada 120 ms), después se trazan los edges a 600 px/s, y el blip (el lápiz) recorre cada trazo.
- **`chart`:** barras horizontales, una fila cada una. La pista es `bg-300`, la barra normal `line-strong` y **la barra destacada va en cian**, con su valor en Geist Mono 16 px a la derecha. Una barra con datos del atacante va en ámbar. La etiqueta de cada fila va a la izquierda, en Geist 14 px `ink-muted`.

### 7. `card`, `note` y `button`

- **`card` (conclusión):** fondo `bg-100`, borde 1 px `line`, `radius-md` y padding de 20 px. Arriba, un check en pixel de 16×16 cian + "CONCLUSIÓN" en Geist Mono 11 px `ink-faint`. El texto en Geist 16 px `ink`. El ✓ de texto se reemplaza por el check en pixel.
- **`note` (nota adhesiva → nota de bitácora):** fondo `defense-soft`, sin borde de color a la izquierda, `radius-sm` y padding de 14 px. Arriba "NOTA" en Geist Mono 11 px cian y el texto en Geist 15 px `ink`.
- **`button` (siguiente pregunta):** el botón secundario de Mayday: transparente, borde 1 px `line-strong`, `radius-md`, 40 px de alto y Geist 13 px / 500. En hover, borde cian. El texto empieza con verbo ("Pregúntale por qué pasó").

### 8. Tipografía

**Todo en Geist y Geist Mono. No hay excepción de letra a mano.** La torre de control escribe como un instrumento, no como un plumón: eso es lo que hace que Hinty se sienta parte de Mayday y no un sticker encima. Salen Kalam, Caveat, Silkscreen, Inter, Archivo Black e Instrument Serif.

- Textos y explicaciones: Geist. Etiquetas, atajos, nombres de piezas y números: Geist Mono.
- **Cómo se carga:** si el kit corre en el mismo documento que la app, usa las variables `--font-geist-sans` y `--font-geist-mono` que ya pone el `layout`. Si el kit carga su propio CSS (iframe o shadow DOM), reemplaza el `@import` de Google Fonts por uno solo:
  `@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');`

### 9. Movimiento

- **Entrada de piezas** (en vez de `clicky-pop`): opacidad 0 → 1 + `translateY(8px)` → 0, en 200 ms con `cubic-bezier(.2,.8,.2,1)`. Sin escala ni rebote.
- **Salida:** opacidad 1 → 0 + `translateY(4px)`, en 150 ms con `ease-in`.
- **Trazo:** 600 px/s, con un mínimo de 250 ms y un máximo de 700 ms por marca.
- **Onda:** `steps(4)` a unos 8 fps.
- **Parpadeos:** el `target` late cada 1,2 s y los pixeles de "pensando" van en un ciclo de 900 ms. El pixel de estado del dock no parpadea. Nada supera **3 parpadeos por segundo**.
- **`prefers-reduced-motion`:** las marcas aparecen completas sin trazo, el `target` y el pulso de radio no se animan, la onda queda fija a media altura y el subtítulo aparece entero.

### 10. Copy

| Hoy | Hinty |
|---|---|
| ¿Dudas? ¡Pregúntame! | ¿Te trabaste? Pregúntale a Hinty |
| Activar Clicky: pregúntale a tu pantalla | Activa a Hinty: te explica lo que ves en pantalla |
| Activando Clicky… | Conectando con Hinty… |
| Apagar Clicky | Apagar Hinty |
| Viendo tu pantalla | Hinty ve tu pantalla |
| Solo texto | Hinty lee solo el texto |
| espacio = hablar | Hablar con Hinty · Mantén fn (o este botón) mientras hablas y suelta para enviar |
| Estoy viendo tu pantalla. ¿Qué quieres saber? | Veo tu pantalla. ¿En qué te ayudo? |
| No veo tu pantalla, pero leo el texto. ¿Qué quieres saber? | No veo tu pantalla, pero leo el texto. ¿En qué te ayudo? |
| Dejé de ver tu pantalla; sigo leyendo el texto | Dejé de ver tu pantalla. Sigo leyendo el texto. |
| Escribe tu pregunta y presiona Enter | Escribe tu pregunta y aprieta Enter |
| Pregúntame lo que quieras de tu pantalla | Pregúntame por lo que ves en pantalla |
| Te escucho… | Te escucho… |
| Mantén apretado mientras hablas | Mantén fn o el botón mientras hablas |
| Transcribiendo… | Transcribiendo… |
| No pude responder: … | No pude responder: … |
| Sin micrófono: … | No tengo acceso al micrófono: … |
| No pude transcribir: … | No pude transcribir lo que dijiste: … |
| haz clic aquí | Haz clic aquí |

### 11. Ubicación en `/simulate`

La regla es que **Hinty nunca tapa el panel del Agente**. Son dos IA distintas, y si se superponen se confunden.

- **Pizarra:** una región nueva, `data-clicky-region="stage"`, que es el rectángulo de la ventana de Chrome. La pizarra va centrada ahí, con un máximo de 720×440 px. Así explica encima de lo que estás mirando.
- **Columna de tarjetas:** una región nueva, `data-clicky-region="stage-side"`, que es una columna de 320 px pegada al borde derecho de la ventana de Chrome, alineada arriba. Reemplaza a `side` (que hoy cae sobre el Agente). Si no se puede agregar la región, deja `side` pero apuntando a ese rectángulo.
- **Dock:** abajo a la derecha de la columna principal (punto 2).
- **Isla:** arriba al centro de la columna principal (punto 3).

**Cómo se distinguen Hinty y el Agente a simple vista:**

| | Hinty | Agente |
|---|---|---|
| Capa | Mayday | Simulada |
| Colores | Azul-negros de marca + cian | Grises `sim-*` |
| Dónde | Dock, isla y pizarra sobre la pantalla | Chat fijo a la derecha |
| Ícono | Audífono de torre en pixel | Ícono genérico |
| Formas | Cuadradas, con glow cian | Burbujas de chat neutras |

### 12. Tokens nuevos

Van en el sistema: `tokens.json` del sistema visual → `mayday-tokens.css`. Hinty es capa Mayday, así que sus colores son de la marca.

| Token | Valor | Para qué |
|---|---|---|
| `hinty-board` | #071116 | Fondo de la pizarra |
| `hinty-grid` | #12222A | Grilla de 24 px de la pizarra |
| `hinty-highlight` | #2EE6FF40 | Destacador (cian al 25%) |
| `hinty-spotlight` | #050A0DB8 | Oscurecido del spotlight (`bg-000` al 72%) |

Todo lo demás usa tokens que ya existen (`defense`, `defense-deep`, `defense-soft`, `bg-*`, `line*`, `ink*`, `attack*`, `glow-defense`, `shadow-*`).

### 13. Un tema único: `mayday`

Se reemplazan `ink`, `platanus` y `sketch` por un solo tema, `mayday`, que queda como el activo en `config.ts`. Los otros tres se pueden borrar después; no estorban si no se usan. Valores con la forma de `theme.js` (si algún campo espera otro tipo, adáptalo manteniendo el valor):

```js
mayday: {
  ink: '#DDF7FA',                       // texto sobre marcas y pizarra
  mark: '#2EE6FF',                      // ring, frame, underline, target
  arrow: '#2EE6FF',
  zone: 'rgba(46, 230, 255, 0.12)',     // tinte del frame (defense-soft)
  palette: ['#2EE6FF', '#7FF0FF', '#8FA6AE', '#50687A'], // series del chart; ámbar #FF8A00 solo para datos del atacante
  hot: '#2EE6FF',                       // node hot y barra destacada
  highlighter: 'rgba(46, 230, 255, 0.25)', // con mix-blend-mode: screen
  pen: '#2EE6FF',                       // el blip
  glow: '0 0 0 1px rgba(46, 230, 255, 0.4), 0 0 24px rgba(46, 230, 255, 0.2)',
  width: 3,
  wobble: 0,
  hatch: false,
  spotlight: 'rgba(5, 10, 13, 0.72)',
  onDark: true,
}
```
