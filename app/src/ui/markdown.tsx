// AIW-07: answers shown with light formatting — headings, bold, italic, inline code, code blocks, lists,
// links as plain text. Built as Preact elements (never HTML strings), so nothing in an answer can run.
// AIW-09: a line that is only a picture, `![description](address)`, is handed to `renderImage` — the
// caller decides which addresses may be shown as pictures (anything else stays text).
import type { ComponentChildren, JSX } from "preact";

/** Inline: **bold**, *italic* / _italic_, `code`. Everything else stays text. */
function inline(text: string, key: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  // no look-behind in these patterns: older iPhone browsers cannot read it (the whole app would not start)
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*(?!\w)|_[^_\n]+_(?!\w))/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const before = m.index! > 0 ? text[m.index! - 1] : "";
    // *x* and _x_ only between words (not inside snake_case or 2*3*4)
    if ((m[0][0] === "*" && m[0][1] !== "*") || m[0][0] === "_") {
      if (/[\w*]/.test(before)) continue;
    }
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface CodeBlock {
  lang: string;
  code: string;
}

/** The fenced code blocks of an answer (for "Run" / "Download"). */
export function codeBlocks(text: string): CodeBlock[] {
  return [...text.matchAll(/^[ \t]*```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)].map((m) => ({ lang: m[1].toLowerCase(), code: m[2] }));
}

const IMAGE_LINE = /^\s*!\[([^\]\n]*)\]\((\S+)\)\s*$/;

export function Markdown(props: { text: string; renderCode?: (b: CodeBlock, i: number) => JSX.Element | null; renderImage?: (alt: string, url: string) => JSX.Element | null }): JSX.Element {
  const lines = props.text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: JSX.Element[] = [];
  let i = 0;
  let n = 0;
  let codeIndex = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^[ \t]*```[ \t]*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^[ \t]*```[ \t]*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end)
      const b = { lang: fence[1].toLowerCase(), code: body.join("\n") + "\n" };
      const k = `c${n++}`;
      blocks.push(
        <div class="md-code" key={k}>
          <pre><code>{b.code}</code></pre>
          {props.renderCode?.(b, codeIndex)}
        </div>,
      );
      codeIndex++;
      continue;
    }
    const img = props.renderImage ? IMAGE_LINE.exec(line) : null;
    if (img) {
      const el = props.renderImage!(img[1], img[2]);
      if (el) {
        blocks.push(<div class="md-image" key={`i${n++}`}>{el}</div>);
        i++;
        continue;
      }
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const k = `h${n++}`;
      const level = Math.min(4, h[1].length + 1);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      blocks.push(<Tag class="md-h" key={k}>{inline(h[2], k)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const k = `l${n++}`;
      const lis = items.map((it, j) => <li key={`${k}-${j}`}>{inline(it, `${k}-${j}`)}</li>);
      blocks.push(ordered ? <ol key={k}>{lis}</ol> : <ul key={k}>{lis}</ul>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^[ \t]*```/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) para.push(lines[i++]);
    const k = `p${n++}`;
    blocks.push(<p key={k}>{para.flatMap((l, j) => (j ? [<br key={`${k}-br${j}`} />, ...inline(l, `${k}-${j}`)] : inline(l, `${k}-${j}`)))}</p>);
  }
  return <div class="md">{blocks}</div>;
}
