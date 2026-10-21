import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatClock, formatDayClock, normalizeStatus } from "@/lib/format";
import type { EquipmentStatus, HistoryEntry, Paged } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { EquipmentStatusLabel } from "@/components/EquipmentRegister";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface OverviewItem {
  id: string;
  name: string;
  status: EquipmentStatus;
  total: number;
  history: HistoryEntry[];
}

const HistoryRow = ({ entry }: { entry: HistoryEntry }) => {
  const status = normalizeStatus(entry.status);
  const who = entry.student ? `${entry.student.name} (${entry.student.rollNo})` : entry.rollNo;
  return (
    <li className="grid grid-cols-[9rem_5.5rem_minmax(0,1fr)] gap-4 py-3 text-sm">
      <time dateTime={entry.changedAt} className="text-muted-foreground tabular">
        {formatDayClock(entry.changedAt)}
      </time>
      <EquipmentStatusLabel status={status} />
      <span className="min-w-0">
        {status === "in_use" ? (
          <>
            {who ?? "Unknown student"}
            {entry.dueAt && <span className="text-muted-foreground tabular">, due {formatClock(entry.dueAt)}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">{status === "available" ? "Back at the desk" : "Taken out of use"}</span>
        )}
        {entry.staff && <span className="text-muted-foreground">, by {entry.staff}</span>}
      </span>
    </li>
  );
};

const FullHistory = ({ item, onClose }: { item: OverviewItem; onClose: () => void }) => {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: [...qk.itemHistory, item.id, page],
    queryFn: () => api.get<Paged & { history: HistoryEntry[] }>(`/admin/get-equipment-history/${item.id}${qs({ page })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="capitalize">{item.name}</DialogTitle>
          <DialogDescription>Every status change, newest first. History is kept for 90 days.</DialogDescription>
        </DialogHeader>
        {history.error ? (
          <ErrorState error={history.error} onRetry={() => history.refetch()} />
        ) : !history.data ? (
          <ListSkeleton rows={5} rowClassName="h-8" />
        ) : (
          <>
            <ol className="divide-y divide-border border-y border-border max-h-[60vh] overflow-y-auto">
              {history.data.history.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </ol>
            {history.data.totalPages > 1 && (
              <nav className="flex items-center gap-3" aria-label="Pages">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Newer
                </Button>
                <span className="text-sm text-muted-foreground tabular">
                  Page {history.data.page} of {history.data.totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= history.data.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Older
                </Button>
              </nav>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const EquipmentHistoryPage = () => {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<OverviewItem | null>(null);
  const overview = useQuery({ queryKey: qk.historyOverview, queryFn: () => api.get<OverviewItem[]>("/admin/get-equipment-history-overview") });

  const term = search.trim().toLowerCase();
  const items = (overview.data ?? []).filter((i) => !term || i.name.toLowerCase().includes(term));

  return (
    <div className="min-h-screen bg-background">
      <Navbar role="admin" />
      <PageHeader title="History" description="Every status change for each item, who had it, and which staff member made the change." width="max-w-4xl" />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-4xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <div className="relative max-w-sm mb-10">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input type="search" placeholder="Search equipment" aria-label="Search equipment" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        {overview.error ? (
          <ErrorState title="Couldn't load history" error={overview.error} onRetry={() => overview.refetch()} />
        ) : overview.isLoading ? (
          <ListSkeleton rows={4} rowClassName="h-28" />
        ) : items.length === 0 ? (
          <EmptyState title={term ? `No equipment matches “${search.trim()}”` : "No equipment yet"}>
            {term ? "Check the spelling or clear the search." : "History appears here once items are added and lent."}
          </EmptyState>
        ) : (
          <div className="space-y-12">
            {items.map((item) => (
              <section key={item.id} aria-labelledby={`history-${item.id}`}>
                <div className="flex items-baseline justify-between gap-4 mb-2">
                  <h2 id={`history-${item.id}`} className="type-heading text-xl capitalize">
                    {item.name}
                  </h2>
                  {item.total > item.history.length && (
                    <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setOpen(item)}>
                      All {item.total} changes
                    </Button>
                  )}
                </div>
                {item.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground border-y border-border py-3">No changes recorded yet.</p>
                ) : (
                  <ol className="divide-y divide-border border-y border-border">
                    {item.history.map((entry) => (
                      <HistoryRow key={entry.id} entry={entry} />
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
        )}
      </main>

      {open && <FullHistory item={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

export default EquipmentHistoryPage;
