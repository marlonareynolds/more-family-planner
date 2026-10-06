import { requireHousehold } from "@/server/page-data";
import { NavBar } from "@/components/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { household, actor } = await requireHousehold();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col md:flex-row">
      <NavBar householdName={household.name} myName={actor.displayName} />
      <main id="main" className="flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-12 md:pt-8">
        {process.env.MORE_DEMO_DB === "1" && (
          <p className="mb-4 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">Demo preview with made-up people. Anything you enter can disappear at any time.</p>
        )}
        {children}
      </main>
    </div>
  );
}
