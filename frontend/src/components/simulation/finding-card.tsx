import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Finding } from "@/lib/types";

/** Hallazgo real del repo + fragmento de código que lo ancla (credibilidad). */
export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="destructive">{finding.severity}</Badge>
          <Badge variant="outline" className="font-mono">
            {finding.vector}
          </Badge>
        </div>
        <CardTitle>{finding.title}</CardTitle>
        <CardDescription>{finding.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <CodeSnippet file={finding.file} line={finding.line} code={finding.snippet} />
      </CardContent>
    </Card>
  );
}

export function CodeSnippet({ file, line, code }: { file: string; line: number; code: string }) {
  return (
    <figure className="overflow-hidden rounded-lg border bg-terminal">
      <figcaption className="border-b px-3 py-1.5 font-mono text-xs text-muted-foreground">
        {file}:{line}
      </figcaption>
      <pre className="overflow-x-auto p-3 font-mono text-xs text-terminal-foreground">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
