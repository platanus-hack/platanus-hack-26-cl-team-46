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

- Íconos de línea de 1.5px, cuadrados, del set Lucide (ya viene con shadcn). En la capa simulada, favicons genéricos con una letra sobre `sim-300`.
- Sin logos de terceros reales dentro del escritorio, salvo el de GitHub en el botón de login. El panel del agente dice "Agente" con un ícono genérico.
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
- Sin logos de terceros reales: favicons genéricos (`sim-300`) con una letra.
- Cuando el atacante toca el navegador: `is-compromised` (glow ámbar), más un cambio de contenido que lo explique.

### AgentPanel

Capa simulada. El chat con el agente de respuesta a incidentes, a la derecha del escritorio, de alto completo. El usuario le escribe para que lo ayude o resuelve a mano en el navegador.

- **La IA viene integrada en Mayday.** El usuario no conecta su propio Claude ni ninguna cuenta de IA: el agente ya está en el simulacro. No lo digas de otra forma en ningún copy ("conecta tu Claude", "tu agente de código", etc.).
- Grises `sim-*`. Header con ícono genérico, el nombre "Agente" y el contexto ("Respuesta a incidente").
- Mensajes del usuario en burbuja `sim-200` a la derecha. Las respuestas del agente van sin burbuja: texto plano con negritas, secciones en mono mayúscula ("AHORA · PRIMEROS 5 MINUTOS") y pasos numerados.
- No uses colores de marca adentro. Si el agente sugiere algo correcto, se nota en los logs (fila OK), no en el chat.
- Composer abajo, con placeholder "Escríbele al agente…" y botón de enviar.
- Sin logos de proveedores de IA: va el ícono genérico.

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
