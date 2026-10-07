import { requireHousehold } from "@/server/page-data";
import { NavBar } from "@/components/nav";
import { Toaster } from "@/components/toast";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { household, actor } = await requireHousehold();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col md:flex-row">
      <NavBar householdName={household.name} myName={actor.displayName} />
      <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-5 md:px-10 md:pb-12 md:pt-10">
        {process.env.MORE_DEMO_DB === "1" && (
          <p className="mb-4 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">Demo preview with made-up people. Anything you enter can disappear at any time.</p>
        )}
        {children}
      </main>
      <Toaster />
    </div>
  );
}
