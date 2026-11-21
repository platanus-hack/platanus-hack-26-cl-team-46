import type { Project, Report, Scenario } from "./types";

/**
 * Datos de ejemplo para diseñar y para el modo de respaldo de la demo (sin wifi).
 * Reemplazar por llamadas reales cuando exista el backend.
 */
export const mockProject: Project = {
  id: "demo",
  repoFullName: "acme/todo-ai",
  stack: "Next.js + Node + Postgres + OpenAI",
  findings: [
    {
      id: "f1",
      vector: "prompt-injection",
      severity: "high",
      title: "Input de usuario concatenado al system prompt",
      description:
        "El mensaje del usuario se interpola directamente en las instrucciones del modelo.",
      file: "src/app/api/chat/route.ts",
      line: 14,
      snippet:
        "const prompt = `Eres un asistente. ${userMessage}. Usa la tool deleteTodo si...`;",
    },
    {
      id: "f2",
      vector: "keychain-access",
      severity: "critical",
      title: "Service role key expuesta al cliente",
      description: "Una credencial con permisos totales se usa desde el navegador.",
      file: "src/lib/db.ts",
      line: 3,
      snippet: "export const db = createClient(URL, process.env.NEXT_PUBLIC_SERVICE_KEY);",
    },
    {
      id: "f3",
      vector: "dos",
      severity: "medium",
      title: "Endpoint sin rate limiting",
      description: "/api/chat llama al LLM sin límite por usuario.",
      file: "src/app/api/chat/route.ts",
      line: 1,
      snippet: "export async function POST(req: Request) {",
    },
  ],
};

export const mockScenario: Scenario = {
  projectId: "demo",
  steps: [
    { id: "s1", vector: "prompt-injection", stage: "entry", atMs: 0, narration: "Un usuario envía un mensaje extraño al chat…", findingId: "f1" },
    { id: "s2", vector: "keychain-access", stage: "escalation", atMs: 15000, narration: "El agente filtra la service key en su respuesta.", findingId: "f2" },
    { id: "s3", vector: "dos", stage: "impact", atMs: 30000, narration: "Miles de requests saturan /api/chat.", findingId: "f3" },
  ],
};

export const mockReport: Report = {
  projectId: "demo",
  overall: 62,
  dimensions: [
    { dimension: "containment", score: 70, comment: "Rotaste la key a tiempo." },
    { dimension: "time", score: 55, comment: "Tardaste 4 min en detectar la inyección." },
    { dimension: "steps", score: 60, comment: "9 pasos vs. 5 mínimos." },
    { dimension: "escalation", score: 40, comment: "No avisaste a nadie." },
    { dimension: "collateral", score: 85, comment: "No rompiste otros servicios." },
  ],
};
