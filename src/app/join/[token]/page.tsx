import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth";
import { JoinButton } from "./join-button";

export const metadata = { title: "Join a household" };

export default async function Join(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  if (!(await currentActor())) redirect(`/sign-in?next=${encodeURIComponent(`/join/${token}`)}`);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <p className="font-display text-3xl text-brand">More</p>
      <h1 className="font-display text-3xl">Join your household</h1>
      <p className="text-ink-2">
        You will share the diary, plans, childcare and costs. Your journal, check-ins and reflections stay private to you, and you can leave and take them with you at any time.
      </p>
      <JoinButton token={token} />
    </main>
  );
}
