import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { displayView } from "@/server/queries/display";
import { DisplayScreen } from "./display-screen";

export const metadata: Metadata = { title: "Our week", robots: { index: false, follow: false } };

/**
 * The kitchen display and a child's own view: a no-account screen for a
 * tablet on the fridge or a child's device. Family logistics only.
 */
export default async function DisplayPage(props: PageProps<"/display/[token]">) {
  const { token } = await props.params;
  const view = await displayView(await getDb(), token);
  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-16">
        <p className="font-display text-3xl text-brand">More</p>
        <h1 className="font-display text-2xl">This screen has been switched off.</h1>
        <p className="text-ink-2">A grown-up can make a new link in More, under Settings, Family screens.</p>
      </main>
    );
  }
  return <DisplayScreen token={token} view={view} />;
}
