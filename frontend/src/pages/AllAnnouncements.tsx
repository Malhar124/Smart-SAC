import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatDate } from "@/lib/format";
import type { Announcement, Paged } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";

/** Public: anyone can read announcements, signed in or not */
const AllAnnouncements = () => {
  const { authType } = useAuth();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [...qk.announcements, page],
    queryFn: () => api.get<Paged & { announcements: Announcement[] }>(`/users/get-announcements${qs({ page })}`),
    placeholderData: keepPreviousData,
  });
  const data = query.data;

  return (
    <div className="min-h-screen bg-background">
      {authType ? (
        <Navbar role={authType} />
      ) : (
        <header className="fixed top-0 inset-x-0 z-50 bg-court text-court-foreground">
          <div className="container mx-auto px-4 md:px-6 h-16 flex items-center">
            <a href="/" className="type-display text-[1.75rem] leading-none">
              Smart SAC
            </a>
          </div>
        </header>
      )}
      <PageHeader title="Announcements" description="News from the SAC office, newest first." width="max-w-3xl" />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-3xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        {query.error ? (
          <ErrorState title="Couldn't load announcements" error={query.error} onRetry={() => query.refetch()} />
        ) : !data ? (
          <ListSkeleton rows={3} rowClassName="h-24" />
        ) : data.announcements.length === 0 ? (
          <EmptyState title="No announcements yet">The SAC office posts closures, new equipment and tournaments here.</EmptyState>
        ) : (
          <>
            <ol className="space-y-8">
              {data.announcements.map((ann) => (
                <li key={ann.id} className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-6">
                  <time dateTime={ann.createdAt} className="text-sm text-muted-foreground tabular sm:pt-1">
                    {formatDate(ann.createdAt)}
                  </time>
                  <article className="border-l-[3px] border-primary pl-4">
                    <h2 className="type-heading text-lg">{ann.heading}</h2>
                    <p className="mt-1 text-muted-foreground max-w-[65ch] whitespace-pre-line">{ann.content}</p>
                    {ann.footer && <p className="mt-2 text-sm text-muted-foreground">{ann.footer}</p>}
                  </article>
                </li>
              ))}
            </ol>
            {data.totalPages > 1 && (
              <nav className="mt-10 flex items-center gap-3" aria-label="Pages">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Newer
                </Button>
                <span className="text-sm text-muted-foreground tabular">
                  Page {data.page} of {data.totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Older
                </Button>
              </nav>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default AllAnnouncements;
