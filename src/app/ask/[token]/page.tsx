import { getDb } from "@/db/client";
import { fmtDate, localParts } from "@/components/format";
import { askView } from "@/server/commands/village";
import { AskAnswer } from "./ask-answer";

export const metadata = { title: "Can you help?", robots: { index: false, follow: false } };

/**
 * What a helper sees: who's asking, the time, the children's first names and
 * a reply. No account, no tracking, nothing else about the household.
 */
export default async function AskPage(props: PageProps<"/ask/[token]">) {
  const { token } = await props.params;
  const view = token.length >= 10 && token.length <= 100 ? await askView(await getDb(), token) : null;
  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-16">
        <p className="font-display text-3xl text-brand">More</p>
        <h1 className="font-display text-2xl">This link has ended.</h1>
        <p className="text-ink-2">If you need anything, ask whoever sent it.</p>
      </main>
    );
  }
  const s = localParts(view.start, view.timeZone);
  const e = localParts(view.end, view.timeZone);
  const when = `${fmtDate(s.date, { month: "long" })}, ${s.time} to ${e.date === s.date ? e.time : `${fmtDate(e.date)} ${e.time}`}`;
  const kids = view.childNames.length ? view.childNames.join(" and ") : "the children";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-16">
      <p className="font-display text-3xl text-brand">More</p>
      <h1 className="font-display text-3xl">Hi {view.helperName}</h1>
      <p className="text-lg">
        {view.askerName} is asking if you could look after {kids} on <strong>{when}</strong>.
      </p>
      {view.note && <p className="rounded-xl bg-surface-2 p-3 text-ink-2">“{view.note}”</p>}
      <AskAnswer token={token} initial={view.response} open={view.open} askerName={view.askerName} />
      <p className="text-xs text-ink-3">You don&apos;t need an account. Your answer goes only to {view.askerName}&apos;s household.</p>
    </main>
  );
}
