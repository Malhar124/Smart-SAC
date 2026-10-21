import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { timeAgo } from "@/lib/format";
import { brokenTicketSchema, requestTicketSchema, serverFieldErrors, validate, type FieldErrors } from "@/lib/schemas";
import type { StudentDashboard, Ticket } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { Field, fieldProps } from "@/components/Field";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { TicketReplyForm, TicketStatusLabel, TicketTimeline } from "@/components/TicketTimeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const emptyBroken = { equipmentId: "", heading: "", content: "" };
const emptyRequest = { game: "", equipment: "", heading: "", details: "" };

const TicketsPage = () => {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("ticket");
  const [tab, setTab] = useState(selectedId ? "mine" : "mine");

  const [broken, setBroken] = useState(emptyBroken);
  const [brokenErrors, setBrokenErrors] = useState<FieldErrors>({});
  const [request, setRequest] = useState(emptyRequest);
  const [requestErrors, setRequestErrors] = useState<FieldErrors>({});

  const tickets = useQuery({ queryKey: qk.myTickets, queryFn: () => api.get<Ticket[]>("/users/get-my-tickets") });
  const equipment = useQuery({ queryKey: qk.studentDashboard, queryFn: () => api.get<StudentDashboard>("/users/dashboard") });
  const selected = useQuery({
    queryKey: qk.ticket(selectedId ?? ""),
    queryFn: () => api.get<Ticket>(`/users/get-ticket/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const openTicket = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("ticket", id);
    else next.delete("ticket");
    setParams(next, { replace: true });
  };

  const afterCreate = (ticket: Ticket) => {
    queryClient.invalidateQueries({ queryKey: qk.myTickets });
    queryClient.invalidateQueries({ queryKey: qk.studentDashboard });
    setTab("mine");
    openTicket(ticket.id);
  };

  const sendBroken = useMutation({
    mutationFn: (body: typeof emptyBroken) => api.post<Ticket>("/users/create-ticket", body),
    onSuccess: (ticket) => {
      toast.success("Report sent", { description: "The SAC desk sees it on their ticket list." });
      setBroken(emptyBroken);
      afterCreate(ticket);
    },
    onError: (error) => setBrokenErrors(serverFieldErrors(error)),
  });

  const sendRequest = useMutation({
    mutationFn: (body: typeof emptyRequest) => api.post<Ticket>("/users/request-new-equipment", body),
    onSuccess: (ticket) => {
      toast.success("Request sent", { description: "The SAC desk sees it on their ticket list." });
      setRequest(emptyRequest);
      afterCreate(ticket);
    },
    onError: (error) => setRequestErrors(serverFieldErrors(error)),
  });

  const reply = useMutation({
    mutationFn: (body: string) => api.post<Ticket>(`/users/add-ticket-comment/${selectedId}`, { body }),
    onSuccess: (ticket) => {
      queryClient.setQueryData(qk.ticket(ticket.id), ticket);
      queryClient.invalidateQueries({ queryKey: qk.myTickets });
    },
  });

  const submitBroken = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(brokenTicketSchema, broken);
    setBrokenErrors(result.errors ?? {});
    if (result.data) sendBroken.mutate(result.data);
  };

  const submitRequest = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(requestTicketSchema, request);
    setRequestErrors(result.errors ?? {});
    if (result.data) sendRequest.mutate(result.data);
  };

  const list = tickets.data ?? [];
  const ticket = selected.data;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHeader title="Tickets" description="Tell the SAC desk when something's broken or missing, and follow their replies here." width="max-w-5xl" />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-5xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-8">
            <TabsTrigger value="mine">Your tickets</TabsTrigger>
            <TabsTrigger value="report">Report broken</TabsTrigger>
            <TabsTrigger value="request">Request new</TabsTrigger>
          </TabsList>

          <TabsContent value="mine">
            {tickets.error ? (
              <ErrorState title="Couldn't load your tickets" error={tickets.error} onRetry={() => tickets.refetch()} />
            ) : tickets.isLoading ? (
              <ListSkeleton rows={3} rowClassName="h-16" />
            ) : list.length === 0 ? (
              <EmptyState
                title="No tickets yet"
                action={
                  <Button variant="outline" size="sm" onClick={() => setTab("report")}>
                    Report broken equipment
                  </Button>
                }
              >
                When you report a problem or ask for new equipment, it shows up here with the desk's replies.
              </EmptyState>
            ) : (
              <div className="grid gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
                <ul className="divide-y divide-border border-y border-border self-start" aria-label="Your tickets">
                  {list.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => openTicket(t.id)}
                        aria-current={selectedId === t.id ? "true" : undefined}
                        className={cn(
                          "w-full text-left px-3 py-3 border-l-[3px] transition-colors hover:bg-accent",
                          selectedId === t.id ? "border-primary bg-accent" : "border-transparent"
                        )}
                      >
                        <span className="block font-medium leading-snug">{t.heading}</span>
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

                <section aria-live="polite" className="min-w-0">
                  {!selectedId ? (
                    <p className="text-muted-foreground">Pick a ticket to see its history and reply.</p>
                  ) : selected.isLoading ? (
                    <ListSkeleton rows={3} />
                  ) : selected.error || !ticket ? (
                    <ErrorState title="Couldn't open that ticket" error={selected.error} onRetry={() => selected.refetch()} />
                  ) : (
                    <article className="space-y-6">
                      <header>
                        <h2 className="type-heading text-2xl">{ticket.heading}</h2>
                        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <TicketStatusLabel status={ticket.status} />
                          <span className="capitalize">
                            {ticket.kind === "broken" ? ticket.equipment?.name ?? "Removed item" : `Request: ${ticket.requestedItem} (${ticket.requestedGame})`}
                          </span>
                        </p>
                      </header>
                      <TicketTimeline ticket={ticket} viewer="student" />
                      {ticket.status === "closed" ? (
                        <p className="text-sm text-muted-foreground">This ticket is closed. Open a new one if the problem comes back.</p>
                      ) : (
                        <TicketReplyForm onSubmit={(body) => reply.mutateAsync(body)} pending={reply.isPending} placeholder="Add details or answer the desk" />
                      )}
                    </article>
                  )}
                </section>
              </div>
            )}
          </TabsContent>

          <TabsContent value="report">
            <form onSubmit={submitBroken} className="space-y-6 max-w-2xl" noValidate>
              <Field id="equipmentId" label="Equipment" error={brokenErrors.equipmentId}>
                <Select value={broken.equipmentId} onValueChange={(v) => setBroken({ ...broken, equipmentId: v })}>
                  <SelectTrigger {...fieldProps("equipmentId", brokenErrors.equipmentId)} className="[&>span]:first-letter:uppercase">
                    <SelectValue placeholder={equipment.isLoading ? "Loading…" : "Choose the item"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(equipment.data?.equipment ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id} className="capitalize">
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="heading" label="What's wrong" error={brokenErrors.heading}>
                <Input {...fieldProps("heading", brokenErrors.heading)} value={broken.heading} onChange={(e) => setBroken({ ...broken, heading: e.target.value })} placeholder="Cue tip has come off" />
              </Field>
              <Field id="content" label="Details" error={brokenErrors.content}>
                <Textarea
                  {...fieldProps("content", brokenErrors.content)}
                  value={broken.content}
                  onChange={(e) => setBroken({ ...broken, content: e.target.value })}
                  placeholder="When you noticed it and anything staff should know"
                  rows={5}
                />
              </Field>
              <Button type="submit" disabled={sendBroken.isPending}>
                {sendBroken.isPending ? "Sending report…" : "Send report"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="request">
            <form onSubmit={submitRequest} className="space-y-6 max-w-2xl" noValidate>
              <div className="grid gap-6 sm:grid-cols-2">
                <Field id="game" label="Game" error={requestErrors.game}>
                  <Input {...fieldProps("game", requestErrors.game)} value={request.game} onChange={(e) => setRequest({ ...request, game: e.target.value })} placeholder="Cricket" />
                </Field>
                <Field id="equipment" label="Equipment" error={requestErrors.equipment}>
                  <Input {...fieldProps("equipment", requestErrors.equipment)} value={request.equipment} onChange={(e) => setRequest({ ...request, equipment: e.target.value })} placeholder="Leather ball" />
                </Field>
              </div>
              <Field id="request-heading" label="Why it's needed" error={requestErrors.heading}>
                <Input
                  {...fieldProps("request-heading", requestErrors.heading)}
                  value={request.heading}
                  onChange={(e) => setRequest({ ...request, heading: e.target.value })}
                  placeholder="Only two balls left for the inter-batch tournament"
                />
              </Field>
              <Field id="details" label="Details" error={requestErrors.details}>
                <Textarea
                  {...fieldProps("details", requestErrors.details)}
                  value={request.details}
                  onChange={(e) => setRequest({ ...request, details: e.target.value })}
                  placeholder="How many, and by when"
                  rows={5}
                />
              </Field>
              <Button type="submit" disabled={sendRequest.isPending}>
                {sendRequest.isPending ? "Sending request…" : "Send request"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default TicketsPage;
