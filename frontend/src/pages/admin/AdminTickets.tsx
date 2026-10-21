import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatDayClock, TICKET_STATUS_LABEL, timeAgo } from "@/lib/format";
import type { StaffTicketList, Ticket, TicketStatus } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { TicketReplyForm, TicketStatusLabel, TicketTimeline } from "@/components/TicketTimeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Filter = "all" | TicketStatus;
const FILTERS: Filter[] = ["open", "in_process", "closed", "all"];

const useDebounced = (value: string, ms = 300) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
};

const TicketDetail = ({ ticketId }: { ticketId: string }) => {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const ticket = useQuery({ queryKey: qk.ticket(ticketId), queryFn: () => api.get<Ticket>(`/admin/get-ticket/${ticketId}`) });

  const update = (fresh: Ticket) => {
    queryClient.setQueryData(qk.ticket(fresh.id), fresh);
    queryClient.invalidateQueries({ queryKey: qk.staffTickets });
    queryClient.invalidateQueries({ queryKey: qk.staffDashboard });
  };

  const setStatus = useMutation({
    mutationFn: (newStatus: TicketStatus) => api.post<Ticket>("/admin/update-ticket", { ticketId, newStatus, note: note.trim() || undefined }),
    onSuccess: (fresh, status) => {
      update(fresh);
      setNote("");
      toast.success(`Marked ${TICKET_STATUS_LABEL[status].toLowerCase()}`, { description: "The student has been notified." });
    },
  });
  const reply = useMutation({
    mutationFn: (body: string) => api.post<Ticket>(`/admin/add-ticket-comment/${ticketId}`, { body }),
    onSuccess: (fresh) => {
      update(fresh);
      toast.success("Reply sent", { description: "The student gets a notification." });
    },
  });

  if (ticket.isLoading) return <ListSkeleton rows={4} />;
  if (ticket.error || !ticket.data) return <ErrorState title="Couldn't open that ticket" error={ticket.error} onRetry={() => ticket.refetch()} />;
  const t = ticket.data;

  return (
    <article className="space-y-6">
      <header>
        <h2 className="type-heading text-2xl">{t.heading}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.sender?.fullname} ({t.sender?.roll_no}),{" "}
          <a href={`mailto:${t.sender?.email}`} className="hover:text-primary underline-offset-4 hover:underline">
            {t.sender?.email}
          </a>
        </p>
        <p className="mt-1 text-sm">
          <span className="capitalize">{t.kind === "broken" ? `Broken: ${t.equipment?.name ?? "removed item"}` : `Request: ${t.requestedItem} for ${t.requestedGame}`}</span>
          <span className="text-muted-foreground">, opened {formatDayClock(t.createdAt)}</span>
        </p>
      </header>

      <TicketTimeline ticket={t} viewer="staff" />

      <section aria-labelledby="status-heading" className="space-y-3 border-t border-border pt-5">
        <h3 id="status-heading" className="text-sm font-medium flex items-center gap-2">
          Status <TicketStatusLabel status={t.status} />
        </h3>
        <label htmlFor="status-note" className="sr-only">
          Note to the student
        </label>
        <Input id="status-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note sent with the status change" maxLength={1000} />
        <div className="flex flex-wrap gap-2">
          {(["open", "in_process", "closed"] as const)
            .filter((s) => s !== t.status)
            .map((s) => (
              <Button key={s} size="sm" variant={s === "closed" ? "default" : "outline"} disabled={setStatus.isPending} onClick={() => setStatus.mutate(s)}>
                {s === "open" ? "Reopen" : s === "in_process" ? "Start work" : "Close ticket"}
              </Button>
            ))}
        </div>
      </section>

      {t.status !== "closed" && (
        <TicketReplyForm onSubmit={(body) => reply.mutateAsync(body)} pending={reply.isPending} placeholder="Ask a question or say what's being done" />
      )}
    </article>
  );
};

const AdminTickets = () => {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("ticket");
  const [filter, setFilter] = useState<Filter>("open");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());

  useEffect(() => setPage(1), [filter, q]);

  const list = useQuery({
    queryKey: [...qk.staffTickets, filter, page, q],
    queryFn: () => api.get<StaffTicketList>(`/admin/get-tickets${qs({ status: filter, page, q })}`),
    placeholderData: keepPreviousData,
  });

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("ticket", id);
    else next.delete("ticket");
    setParams(next, { replace: true });
  };

  const data = list.data;

  return (
    <div className="min-h-screen bg-background">
      <Navbar role="admin" />
      <PageHeader title="Tickets" description="Broken equipment reports and requests for new equipment from students." />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-6xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div className="inline-flex flex-wrap rounded-md border border-border p-0.5 bg-card w-fit" role="group" aria-label="Filter by status">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "h-8 px-3 rounded-[calc(var(--radius)-2px)] text-sm font-medium transition-colors tabular",
                  filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {value === "all" ? "All" : TICKET_STATUS_LABEL[value]} {data && `(${data.counts[value]})`}
              </button>
            ))}
          </div>
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              placeholder="Search heading, item or student"
              aria-label="Search tickets by heading, item or student"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div>
            {list.error ? (
              <ErrorState title="Couldn't load tickets" error={list.error} onRetry={() => list.refetch()} />
            ) : !data ? (
              <ListSkeleton rows={5} rowClassName="h-16" />
            ) : data.tickets.length === 0 ? (
              <EmptyState title={q ? `No tickets match “${q}”` : filter === "open" ? "No open tickets" : "No tickets here"}>
                {filter === "open" && !q ? "Nothing is waiting on the desk." : "Try another status or search."}
              </EmptyState>
            ) : (
              <>
                <ul className={cn("divide-y divide-border border-y border-border transition-opacity", list.isFetching && "opacity-70")} aria-label="Tickets">
                  {data.tickets.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => open(t.id)}
                        aria-current={selectedId === t.id ? "true" : undefined}
                        className={cn(
                          "w-full text-left px-3 py-3 border-l-[3px] transition-colors hover:bg-accent",
                          selectedId === t.id ? "border-primary bg-accent" : "border-transparent"
                        )}
                      >
                        <span className="block font-medium leading-snug">{t.heading}</span>
                        <span className="mt-0.5 block text-sm text-muted-foreground truncate">
                          <span className={cn(t.equipment && "capitalize")}>{t.equipment?.name ?? "New equipment request"}</span>, {t.sender?.fullname}
                        </span>
                        <span className="mt-1 flex items-center justify-between gap-3">
                          <TicketStatusLabel status={t.status} />
                          <span className="text-xs text-muted-foreground">
                            {t.replies ? `${t.replies} ${t.replies === 1 ? "reply" : "replies"}, ` : ""}
                            {timeAgo(t.updatedAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {data.totalPages > 1 && (
                  <nav className="mt-4 flex items-center gap-3" aria-label="Pages">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground tabular">
                      Page {data.page} of {data.totalPages}
                    </span>
                    <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </nav>
                )}
              </>
            )}
          </div>

          <section aria-live="polite" className="min-w-0">
            {selectedId ? (
              <TicketDetail key={selectedId} ticketId={selectedId} />
            ) : (
              <p className="text-muted-foreground">Pick a ticket to see its history, reply or change its status.</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default AdminTickets;
