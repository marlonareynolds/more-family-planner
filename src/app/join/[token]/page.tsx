import Link from "next/link";
import { getDb } from "@/db/client";
import { currentActor } from "@/server/auth";
import { previewInvite, type InviteState } from "@/server/queries/invite";
import { JoinButton } from "./join-button";

export const metadata = { title: "Join a household" };

const DEAD: Record<Exclude<InviteState, "open">, string> = {
  expired: "This invitation has expired. Links last 7 days.",
  used: "This invitation has already been used. Each link works once.",
  cancelled: "This invitation was cancelled, or replaced by a newer link.",
  unknown: "This link isn't a working invitation. It may have been copied only in part.",
};

export default async function Join(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const [actor, invite] = await Promise.all([currentActor(), getDb().then((db) => previewInvite(db, token))]);
  const who = invite.inviterName ?? "the person who invited you";
  const signIn = `/sign-in?next=${encodeURIComponent(`/join/${token}`)}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <p className="font-display text-3xl text-brand">More</p>
      {invite.state === "open" ? (
        <>
          <h1 className="font-display text-3xl">
            {invite.inviterName} has invited you to join {invite.householdName}
          </h1>
          <p className="text-ink-2">
            You will share the diary, plans, childcare and costs with {invite.inviterName}. Your journal, check-ins and reflections stay private to you, and you can leave and take them with you at any time.
          </p>
          <p className="text-ink-2">{invite.inviterName} has already set up the household, so joining takes about a minute.</p>
          {actor ? (
            <JoinButton token={token} />
          ) : (
            <Link href={signIn} className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 font-medium text-brand-ink">
              Sign in to join
            </Link>
          )}
        </>
      ) : (
        <>
          <h1 className="font-display text-3xl">This link no longer works</h1>
          <p className="text-ink-2">{DEAD[invite.state]}</p>
          <p className="text-ink-2">
            Ask {who} to make a new one: in More, Settings, then Adults, then &ldquo;Make a new link&rdquo;.
          </p>
          {actor && (
            <Link href="/today" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-5">
              Go to More
            </Link>
          )}
        </>
      )}
    </main>
  );
}
