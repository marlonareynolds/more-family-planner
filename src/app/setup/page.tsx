import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { currentActor } from "@/server/auth";
import { householdFor } from "@/server/queries/week";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up" };

export default async function Setup() {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in");
  if (await householdFor(await getDb(), actor)) redirect("/today");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <p className="font-display text-3xl text-brand">More</p>
      <h1 className="font-display text-3xl">Welcome, {actor.displayName}</h1>
      <div className="space-y-2 text-ink-2">
        <p>More keeps two kinds of information apart.</p>
        <p><strong className="text-ink">Shared:</strong> the diary, plans you agree together, childcare and costs.</p>
        <p><strong className="text-ink">Private to you:</strong> your journal, check-ins and reflections. Nobody else in the household can see them, including whoever pays.</p>
      </div>
      <SetupForm />
    </main>
  );
}
