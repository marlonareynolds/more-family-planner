import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Renders the small Markdown subset the legal texts use: "## " headings,
 * "- " lists, paragraphs, **bold** and [links](href). Enough for a notice,
 * without a Markdown dependency.
 */
export function LegalDoc({ source }: { source: string }) {
  const blocks = source.trim().split(/\n\s*\n/);
  return (
    <div className="flex flex-col gap-4 leading-relaxed text-ink-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines[0]?.startsWith("## ")) return <h2 key={i} className="mt-4 font-display text-2xl text-ink">{lines[0].slice(3)}</h2>;
        if (lines.every((l) => l.startsWith("- "))) {
          return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>;
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index} className="font-semibold text-ink">{m[1]}</strong>);
    else if (m[3].startsWith("/")) out.push(<Link key={m.index} href={m[3]} className="underline">{m[2]}</Link>);
    else out.push(<a key={m.index} href={m[3]} className="underline" {...(m[3].startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
