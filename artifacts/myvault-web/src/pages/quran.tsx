import { BookOpen, Bookmark, Clock, Search } from "lucide-react";
import { quranPlaceholderItems } from "@/mocks/islamicWeb";
import { PageContainer, PageHeader } from "@/components/page-layout";

export default function QuranPage() {
  return (
    <PageContainer>
      <PageHeader title="Quran" description="Reserved for the Quran reader after restore, courses, library, and study are stable." />

      <section className="max-w-6xl rounded-lg bg-white/70 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-emerald-50 text-primary dark:bg-emerald-950/40">
              <BookOpen className="h-6 w-6" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-foreground">Quran Reader</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              The first Quran pass will focus on restored reader state, bookmarks, and reflections.
            </p>
          </div>
          <div className="grid min-w-64 gap-3">
            {quranPlaceholderItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-md bg-slate-50/70 px-3 py-2">
                <span className="text-sm font-medium text-foreground">{item.label}</span>
                <span className="text-xs text-muted-foreground">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 grid max-w-6xl gap-4 md:grid-cols-3">
        {[
          { label: "Search", icon: Search },
          { label: "Bookmarks", icon: Bookmark },
          { label: "Recent location", icon: Clock },
        ].map(({ label, icon: Icon }) => (
          <div key={label} className="rounded-lg bg-white/65 p-5">
            <Icon className="h-5 w-5 text-primary" />
            <p className="mt-4 text-sm font-semibold text-foreground">{label}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Planned for the later Quran phase.</p>
          </div>
        ))}
      </section>
    </PageContainer>
  );
}
