import { redirect } from "next/navigation";
import { authMode, currentActor } from "@/server/auth";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in" };

export default async function SignIn(props: PageProps<"/sign-in">) {
  if (await currentActor()) redirect("/today");
  const { next } = await props.searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <p className="font-display text-3xl text-brand">More</p>
      <h1 className="font-display text-3xl">Sign in</h1>
      <SignInForm mode={authMode()} next={typeof next === "string" ? next : "/today"} />
    </main>
  );
}
