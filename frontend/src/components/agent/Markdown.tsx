import { Fragment, type ReactNode } from "react";

/**
 * Markdown mínimo para las respuestas del agente: lo que de verdad usa (negritas, `código`,
 * listas, bloques ``` y títulos). Arma nodos de React, nunca HTML crudo: el texto viene de un
 * modelo que lee logs del atacante, así que no se puede confiar en él.
 *
 * Bloques: párrafos (los saltos de línea simples se respetan), `#` títulos, listas `-`/`*`/`•`
 * y `1.`/`1)` (con anidación por sangría), citas `>`, `---` y bloques de código ```.
 * En línea: **negrita**, *cursiva* / _cursiva_, ~~tachado~~, `código` y [links](https://…).
 */
export function Markdown({ text }: { text: string }) {
  return <div className="flex flex-col gap-3">{renderBlocks(text.replace(/\r\n?/g, "\n").split("\n"), "b")}</div>;
}

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;
const BULLET = /^(\s*)([-*+•])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;

type ListItem = { lines: string[] };

function renderBlocks(lines: string[], keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  const key = () => `${keyPrefix}-${out.length}`;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // cierre (si el modelo lo olvidó, el bloque llega hasta el final)
      out.push(<CodeBlock key={key()} lang={fence[2]} code={body.join("\n")} />);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      out.push(
        <p key={key()} className="mt-1 font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.12em] text-sim-ink-muted">
          {renderInline(heading[2])}
        </p>,
      );
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push(<hr key={key()} className="border-sim-line" />);
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ""));
      out.push(
        <blockquote key={key()} className="flex flex-col gap-2 border-l-2 border-sim-300 pl-3 text-sim-ink-muted">
          {renderBlocks(body, key())}
        </blockquote>,
      );
      continue;
    }

    const bullet = line.match(BULLET);
    const first = bullet ?? line.match(ORDERED);
    if (first) {
      const isOrdered = !bullet;
      const marker = isOrdered ? ORDERED : BULLET;
      const indent = first[1].length;
      const start = isOrdered ? Number(first[2]) : 1;
      const items: ListItem[] = [];

      while (i < lines.length) {
        const m = lines[i].match(marker);
        if (m && m[1].length === indent) {
          items.push({ lines: [m[3]] });
          i++;
          continue;
        }
        // Continuación del ítem: líneas con más sangría (sublistas, párrafos del ítem) o una
        // línea en blanco seguida de más sangría.
        const cur = items[items.length - 1];
        const l = lines[i];
        const lead = l.match(/^\s*/)![0].length;
        if (l.trim() && lead > indent) {
          cur.lines.push(l.slice(Math.min(lead, indent + 4)));
          i++;
          continue;
        }
        if (!l.trim() && i + 1 < lines.length) {
          const next = lines[i + 1];
          const nextLead = next.match(/^\s*/)![0].length;
          if (next.trim() && nextLead > indent && !next.match(marker)) {
            cur.lines.push("");
            i++;
            continue;
          }
          const sibling = next.match(marker);
          if (sibling && sibling[1].length === indent) {
            i++; // lista "suelta": una línea en blanco entre ítems
            continue;
          }
        }
        break;
      }

      out.push(isOrdered ? <OrderedList key={key()} start={start} items={items} keyPrefix={key()} /> : <BulletList key={key()} items={items} keyPrefix={key()} />);
      continue;
    }

    // Párrafo: hasta una línea en blanco o el inicio de otro bloque.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !HR.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !ORDERED.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    out.push(
      <p key={key()}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(l)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

/** El contenido de un ítem: si es una sola línea va en línea; si no, como bloques (sublistas, etc.). */
function ItemBody({ item, keyPrefix }: { item: ListItem; keyPrefix: string }) {
  if (item.lines.length === 1) return <>{renderInline(item.lines[0])}</>;
  return <div className="flex flex-col gap-2">{renderBlocks(item.lines, keyPrefix)}</div>;
}

/** Pasos numerados (DESIGN.md › AgentPanel): número en un círculo claro. */
function OrderedList({ start, items, keyPrefix }: { start: number; items: ListItem[]; keyPrefix: string }) {
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item, j) => (
        <li key={j} className="grid grid-cols-[20px_1fr] gap-2.5">
          <span className="mt-px grid size-5 place-items-center rounded-full bg-sim-300 font-mono text-[11px] font-semibold leading-none text-sim-ink">
            {start + j}
          </span>
          <div className="min-w-0">
            <ItemBody item={item} keyPrefix={`${keyPrefix}-${j}`} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function BulletList({ items, keyPrefix }: { items: ListItem[]; keyPrefix: string }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, j) => (
        <li key={j} className="grid grid-cols-[14px_1fr] gap-1.5">
          <span aria-hidden className="mt-[9px] size-[5px] justify-self-center rounded-full bg-sim-ink-muted" />
          <div className="min-w-0">
            <ItemBody item={item} keyPrefix={`${keyPrefix}-${j}`} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-sim-line bg-sim-000">
      {lang && <div className="border-b border-sim-line px-3 py-1.5 font-mono text-[11px] leading-4 text-sim-ink-faint">{lang}</div>}
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-[19px] text-sim-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ---------- En línea ----------

// Orden de prioridad: el código manda (adentro no se interpreta nada), después links y énfasis.
const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|(?<![\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)([^_]+?)(?<!\s)_(?![\w_])/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index!;
    if (at > last) out.push(text.slice(last, at));
    const k = n++;
    if (m[2] !== undefined) {
      out.push(
        <code key={k} className="rounded bg-sim-200 px-1 py-px font-mono text-[12.5px] text-sim-ink">
          {m[2].replace(/^ (.*) $/, "$1")}
        </code>,
      );
    } else if (m[3] !== undefined) {
      out.push(
        <a key={k} href={m[4]} target="_blank" rel="noreferrer noopener" className="underline decoration-sim-ink-faint underline-offset-2 hover:decoration-sim-ink">
          {renderInline(m[3])}
        </a>,
      );
    } else if (m[5] !== undefined || m[6] !== undefined) {
      out.push(
        <strong key={k} className="font-semibold">
          {renderInline(m[5] ?? m[6])}
        </strong>,
      );
    } else if (m[7] !== undefined) {
      out.push(
        <s key={k} className="text-sim-ink-muted">
          {renderInline(m[7])}
        </s>,
      );
    } else {
      out.push(<em key={k}>{renderInline(m[8] ?? m[9])}</em>);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
