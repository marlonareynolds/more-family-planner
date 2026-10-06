import { AppProvider } from "@/components/app-context";
import { infoFrom } from "@/components/app-info";
import { Ideas } from "@/components/ideas";
import { Journal } from "@/components/journal";
import { LearningControls } from "@/components/learning-controls";
import { MomentList } from "@/components/moment-list";
import { SectionTitle } from "@/components/ui";
import { loadRange } from "@/server/page-data";
import { listJournal } from "@/server/queries/journal";
import { heavyWeek } from "@/server/queries/free-time";
import { guidanceFor } from "@/server/queries/learning";

export const metadata = { title: "Me" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : undefined);

export default async function MePage({ searchParams }: PageProps<"/me">) {
  const sp = await searchParams;
  const { view, db, actor } = await loadRange(-28, 84);
  const [guidance, journal] = await Promise.all([
    guidanceFor(db, actor),
    listJournal(db, actor, { q: one(sp.q), tag: one(sp.tag), cursor: one(sp.after), limit: 20 }),
  ]);
  return (
    <AppProvider value={infoFrom(view)}>
      <MomentList data={view} kind="me" title="Me" intro="Protected time that is yours. Your journal, check-ins and feedback are private to you, even inside the household." />
      <SectionTitle>Ideas for you</SectionTitle>
      <Ideas kind="me" guidance={guidance.effective} lighterWeek={await heavyWeek(db, actor, view.household.timeZone)} />
      <Journal data={journal} q={one(sp.q) ?? ""} tag={one(sp.tag) ?? ""} paged={!!one(sp.after)} checkinDone={view.checkinDone} />
      <LearningControls guidance={guidance} />
    </AppProvider>
  );
}
