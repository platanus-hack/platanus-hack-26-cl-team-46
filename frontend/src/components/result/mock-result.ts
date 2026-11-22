import type { Benchmark, SimulationResult } from "./types";

/**
 * Resultado de ejemplo para la demo: simulacro en modo examen contra Apuntes (la app víctima).
 * Texto pre-generado; se reemplaza por el resultado real cuando el backend lo entregue.
 */
export const mockResult: SimulationResult = {
  mode: "examen",
  verdict: "contenido",
  diagnosis:
    "Sacaste al atacante en 07:42, pero te tomó 9 pasos donde bastaban 6. Cambiaste la contraseña de Martín antes de rotar el JWT_SECRET, y durante casi dos minutos el atacante siguió adentro con su token.",
  rank: "Copiloto",
  repo: "hack26-sandboxes/apuntes",
  hud: { time: 462, steps: 9, minSteps: 6, contained: 3 },
  skills: { contencion: 78, reaccion: 64, precision: 52, protocolo: 70, integridad: 86 },
  vectors: [
    { id: "weak-password-no-rate-limit", name: "Fuerza bruta en el login", family: "C", score: 82 },
    { id: "jwt-not-invalidated-on-password-change", name: "JWT robado sigue vivo", family: "B", score: 46 },
    { id: "idor", name: "IDOR en /api/notes/:id", family: "A", score: 71 },
  ],
  timeline: [
    { t: 38, attack: "1.240 intentos de login contra martin.soto", userAction: "Pidió ver los logs de /login", result: "ok" },
    { t: 121, attack: "Login exitoso con qwerty123", userAction: "Cambió la contraseña de Martín", result: "tarde" },
    { t: 188, attack: "El JWT robado sigue sirviendo", userAction: "Rotó JWT_SECRET y redeploy", result: "ok" },
    { t: 301, attack: "Lee notas ajenas por /api/notes/:id", userAction: "Parchó el ownership en la API", result: "ok" },
    { t: 389, attack: "Vuelve por /notes/:id (vista web)", userAction: "Reinició el servicio", result: "empeora" },
    { t: 462, attack: "Sin accesos activos", userAction: "Parchó /notes/:id", result: "ok" },
  ],
  recommendations: {
    summary:
      "Contuviste el ataque sin romper la app, y eso no es poco. La próxima vez, antes de cambiar una contraseña pregúntate: ¿esto invalida las sesiones que ya existen? Si la respuesta es no, el atacante sigue adentro.",
    didWell: [
      "Detectaste la fuerza bruta apenas subieron los 401 y pediste ver los logs antes de tocar nada.",
      "Cuando la verificación dijo que el atacante seguía adentro, rotaste el JWT_SECRET en vez de repetir el cambio de contraseña.",
      "Parchaste el IDOR con un chequeo de ownership, sin botar la app ni perder datos.",
    ],
    improve: [
      {
        point: "Rota el secreto antes de cambiar la contraseña.",
        why: "Los JWT de Apuntes duran 30 días y no se invalidan al cambiar la contraseña. Mientras no rotes JWT_SECRET, el token robado sigue sirviendo.",
      },
      {
        point: "Revisa el alcance antes de dar algo por cerrado.",
        why: "Arreglaste /api/notes/:id pero no /notes/:id, que tenía el mismo bug. El atacante volvió por ahí.",
      },
      {
        point: "Reiniciar no es contener.",
        why: "El restart no cambia secretos ni código: el atacante quedó igual de adentro y perdiste un minuto.",
      },
    ],
  },
  aiUsage: {
    prompts: 7,
    followed: 5,
    manual: 2,
    changes: { commits: 3, env: 1, db: 1, restarts: 1, deploys: 5, failed: 0 },
    firstPrompt: 41,
    avgReply: 12,
    moments: [
      { t: 41, seq: 0, prompt: "Muéstrame los logs de /login", outcome: "seguida", note: "Viste los 1.240 intentos antes de tocar nada." },
      { t: 118, seq: 1, prompt: "Cámbiale la contraseña a Martín", outcome: "seguida", note: "Se hizo por SQL, pero el JWT robado siguió sirviendo." },
      { t: 180, seq: 2, prompt: "Rota JWT_SECRET y redespliega", outcome: "seguida", note: "Redeploy en 25 s: el atacante quedó afuera." },
      { t: 380, seq: 3, prompt: "Reinicia el servicio", outcome: "ignorada", note: "El agente sugirió revisar /notes/:id; reiniciaste igual y no sirvió." },
    ],
  },
  fixes: [
    {
      title: "Invalida los JWT al cambiar la contraseña",
      done: false,
      file: "src/lib/jwt.ts",
      steps: [
        "Agrega una columna token_version a la tabla users.",
        "Inclúyela en el payload al firmar el JWT.",
        "En requireAuth, rechaza los tokens con una versión distinta a la actual.",
        "Incrementa token_version cada vez que cambie la contraseña.",
      ],
    },
    {
      title: "Chequeo de ownership en las notas",
      done: true,
      file: "src/routes/notes.ts",
      steps: [
        "Filtra por user_id en GET /api/notes/:id.",
        "Aplica el mismo filtro en /notes/:id (la vista web).",
        "Agrega un test que pida la nota de otro usuario y espere 404.",
      ],
    },
    {
      title: "Rate limit en el login",
      done: false,
      file: "src/routes/auth.ts",
      steps: [
        "Limita /login a 5 intentos por IP cada 15 minutos.",
        "Bloquea la cuenta 15 minutos después de 10 intentos fallidos.",
        "Exige contraseñas de 12 caracteres o más al registrarse.",
      ],
    },
    {
      title: "Acorta la vida de los tokens",
      done: false,
      file: "src/lib/jwt.ts",
      steps: [
        "Baja la expiración del JWT de 30 días a 1 hora.",
        "Usa refresh tokens rotativos guardados en la base.",
      ],
    },
  ],
};

/** Benchmark de ejemplo para la demo (sin simulación real no hay corridas que comparar). */
export const mockBenchmark: Benchmark = {
  runs: 24,
  devs: 17,
  min_sample: 3,
  overall: {
    score: { you: 70, median: 58, percentile: 71, runs: 24, better: "higher" },
    time: { you: 462, median: 540, percentile: 63, runs: 24, better: "lower" },
    steps: { you: 9, median: 8, percentile: 42, runs: 24, better: "lower" },
    contained_rate: 46,
  },
  skills: { contencion: 61, reaccion: 55, precision: 58, protocolo: 49, integridad: 80 },
  vectors: [
    {
      id: "weak-password-no-rate-limit",
      name: "Fuerza bruta en el login",
      family: "C",
      score: { you: 82, median: 70, percentile: 74, runs: 21, better: "higher" },
    },
    {
      id: "jwt-not-invalidated-on-password-change",
      name: "JWT robado sigue vivo",
      family: "B",
      score: { you: 46, median: 38, percentile: 60, runs: 18, better: "higher" },
    },
    {
      id: "idor",
      name: "IDOR en /api/notes/:id",
      family: "A",
      score: { you: 71, median: 66, percentile: 56, runs: 15, better: "higher" },
    },
  ],
};
