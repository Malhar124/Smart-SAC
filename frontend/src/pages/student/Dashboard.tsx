import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatClock, formatDayClock } from "@/lib/format";
import { RESERVATION_MINUTES } from "@/lib/policy";
import type { CurrentStudent, Player, StudentDashboard as DashboardData, StudentEquipmentItem } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { EquipmentRack } from "@/components/EquipmentRegister";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Filter = "available" | "all";

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const SectionHeading = ({ id, children, action }: { id: string; children: string; action?: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 mb-3">
    <h2 id={id} className="type-heading text-xl">
      {children}
    </h2>
    {action}
  </div>
);

const TextLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
    {children}
  </Link>
);

// Free first, then out, then broken, so the rack reads like the board at the desk
const rackOrder = { available: 0, in_use: 1, broken: 2 } as const;

const StudentDashboard = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const dashboard = useQuery({
    queryKey: qk.studentDashboard,
    queryFn: () => api.get<DashboardData>("/users/dashboard"),
  });
  const me = useQuery({ queryKey: qk.me, queryFn: () => api.get<CurrentStudent>("/users/current-user") });
  const players = useQuery({ queryKey: qk.players, queryFn: () => api.get<Player[]>("/users/get-all-players") });

  // Reserve and cancel update the rack straight away and roll back if the server says no
  const updateRack = (fn: (items: StudentEquipmentItem[]) => StudentEquipmentItem[]) => {
    const previous = queryClient.getQueryData<DashboardData>(qk.studentDashboard);
    if (previous) queryClient.setQueryData<DashboardData>(qk.studentDashboard, { ...previous, equipment: fn(previous.equipment) });
    return { previous };
  };
  const rollback = (context?: { previous?: DashboardData }) => {
    if (context?.previous) queryClient.setQueryData(qk.studentDashboard, context.previous);
  };

  const reserve = useMutation({
    mutationFn: (equipmentId: string) => api.post("/users/reserve-equipment", { equipmentId }),
    onMutate: async (equipmentId) => {
      await queryClient.cancelQueries({ queryKey: qk.studentDashboard });
      const until = new Date(Date.now() + RESERVATION_MINUTES * 60_000).toISOString();
      return updateRack((items) => items.map((i) => (i.id === equipmentId ? { ...i, reservation: { mine: true, until } } : i)));
    },
    onSuccess: () => toast.success(`Held for ${RESERVATION_MINUTES} minutes`, { description: "Collect it from the SAC desk with your ID." }),
    onError: (_e, _id, context) => rollback(context),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.studentDashboard });
      queryClient.invalidateQueries({ queryKey: qk.me });
    },
  });

  const cancel = useMutation({
    mutationFn: (equipmentId: string) => api.post("/users/cancel-reservation", { equipmentId }),
    onMutate: async (equipmentId) => {
      await queryClient.cancelQueries({ queryKey: qk.studentDashboard });
      return updateRack((items) => items.map((i) => (i.id === equipmentId ? { ...i, reservation: null } : i)));
    },
    onSuccess: () => toast.success("Reservation cancelled"),
    onError: (_e, _id, context) => rollback(context),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.studentDashboard }),
  });

  const sendMessage = useMutation({
    mutationFn: (variables: { receiverId: string; content: string }) => api.post("/users/send-message", variables),
    onSuccess: () => toast.success("Request sent", { description: "It's in your chat with them." }),
  });

  const data = dashboard.data;
  const firstName = user?.fullname.split(" ")[0];
  const equipment = data?.equipment ?? [];
  const isFree = (e: StudentEquipmentItem) => e.status === "available" && (!e.reservation || e.reservation.mine);
  const availableCount = equipment.filter(isFree).length;
  const holdingSomething = equipment.some((e) => e.reservation?.mine);
  const pendingId = (reserve.isPending && reserve.variables) || (cancel.isPending && cancel.variables) || null;
  const search = query.trim().toLowerCase();
  const visibleEquipment = equipment
    .filter((e) => filter === "all" || isFree(e))
    .filter((e) => !search || e.name.toLowerCase().includes(search))
    .sort((a, b) => rackOrder[a.status] - rackOrder[b.status]);
  const standing = data?.standing;
  const bookings = me.data?.roomBookings ?? [];
  const announcements = data?.announcements ?? [];
  const openTickets = data?.openTickets ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        description={
          data
            ? equipment.length === 0
              ? "The desk hasn't added any equipment yet."
              : availableCount === 0
                ? "Everything at the SAC is out right now."
                : `${availableCount} of ${equipment.length} items are free at the SAC right now.`
            : undefined
        }
      />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-6xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        {standing?.blocked && (
          <div className="mb-8 border-l-4 border-destructive bg-destructive/10 rounded-r-md px-4 py-3 max-w-3xl" role="status">
            <p className="font-medium">You can't reserve or borrow right now</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{standing.message}</p>
          </div>
        )}

        {dashboard.error ? (
          <ErrorState title="Couldn't load your dashboard" error={dashboard.error} onRetry={() => dashboard.refetch()} />
        ) : (
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-12 min-w-0">
              <section aria-labelledby="equipment-heading">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-4">
                  <h2 id="equipment-heading" className="type-heading text-xl">
                    Equipment
                  </h2>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                      <Input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search equipment"
                        aria-label="Search equipment"
                        className="h-9 pl-9 sm:w-52"
                      />
                    </div>
                    <div className="inline-flex rounded-md border border-border p-0.5 bg-card w-fit" role="group" aria-label="Show">
                      {(["all", "available"] as const).map((value) => (
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
                          {value === "available" ? `Free only (${availableCount})` : `All (${equipment.length})`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {dashboard.isLoading ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy="true" aria-label="Loading equipment">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-28 w-full" />
                    ))}
                  </div>
                ) : equipment.length === 0 ? (
                  <EmptyState title="No equipment yet">The SAC desk adds equipment as it arrives. Check back soon.</EmptyState>
                ) : visibleEquipment.length > 0 ? (
                  <EquipmentRack
                    items={visibleEquipment}
                    onReserve={(id) => reserve.mutate(id)}
                    onCancel={(id) => cancel.mutate(id)}
                    pendingId={pendingId}
                    holdingSomething={holdingSomething}
                    blockedReason={standing?.blocked ? standing.message : null}
                    myRollNo={user?.roll_no.toUpperCase()}
                  />
                ) : search ? (
                  <EmptyState
                    title={`No equipment matches “${query.trim()}”`}
                    action={
                      <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                        Clear search
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title="Nothing is free right now"
                    action={
                      <Button variant="outline" size="sm" onClick={() => setFilter("all")}>
                        See who has what
                      </Button>
                    }
                  >
                    <Link to="/student/busy-times" className="text-primary underline-offset-4 hover:underline">
                      Busy times
                    </Link>{" "}
                    shows when items usually come back.
                  </EmptyState>
                )}

                <p className="mt-4 text-sm text-muted-foreground">
                  Reserve a free item to hold it for {RESERVATION_MINUTES} minutes, then collect it from the SAC desk. You can hold one item at a
                  time.
                </p>
              </section>

              <section aria-labelledby="players-heading">
                <SectionHeading id="players-heading" action={<TextLink to="/student/players">All players</TextLink>}>
                  Find someone to play with
                </SectionHeading>
                {players.isLoading ? (
                  <ListSkeleton rows={3} />
                ) : (players.data ?? []).length === 0 ? (
                  <p className="text-muted-foreground">
                    No other players yet. Add your games on your{" "}
                    <Link to="/student/profile" className="text-primary underline-offset-4 hover:underline">
                      profile
                    </Link>{" "}
                    so people can find you.
                  </p>
                ) : (
                  <ul className="divide-y divide-border border-y border-border">
                    {(players.data ?? []).slice(0, 5).map((player) => {
                      const games = player.games.map((g) => g.game.name);
                      const sending = sendMessage.isPending && sendMessage.variables?.receiverId === player.id;
                      return (
                        <li key={player.id} className="flex items-center justify-between gap-4 py-3">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{player.fullname}</p>
                            <p className={cn("text-sm text-muted-foreground truncate", games.length > 0 && "capitalize")}>
                              {games.length > 0 ? games.join(", ") : "No games added yet"}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={sending}
                            onClick={() =>
                              sendMessage.mutate({
                                receiverId: player.id,
                                content: games[0] ? `Hey! Would you like to play ${games[0]} sometime?` : "Hey! Would you like to play sometime?",
                              })
                            }
                          >
                            {sending ? "Sending…" : "Ask to play"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            <aside className="space-y-10" aria-label="Your SAC">
              <section aria-labelledby="bookings-heading">
                <SectionHeading id="bookings-heading" action={<TextLink to="/student/rooms">Book a room</TextLink>}>
                  Your rooms
                </SectionHeading>
                {me.isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : bookings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No upcoming bookings.</p>
                ) : (
                  <ul className="space-y-3">
                    {bookings.map((b) => (
                      <li key={b.id} className="border-l-[3px] border-line pl-3">
                        <p className="font-medium leading-snug">{b.room.name}</p>
                        <p className="text-sm text-muted-foreground tabular">
                          {formatDayClock(b.startsAt)} to {formatClock(b.endsAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="announcements-heading">
                <SectionHeading id="announcements-heading" action={<TextLink to="/announcements">All</TextLink>}>
                  Announcements
                </SectionHeading>
                {dashboard.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : announcements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No announcements right now.</p>
                ) : (
                  <ul className="space-y-5">
                    {announcements.map((ann) => (
                      <li key={ann.id} className="border-l-[3px] border-primary pl-3">
                        <p className="font-medium leading-snug">{ann.heading}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{ann.content}</p>
                        {ann.footer && <p className="mt-1 text-xs text-muted-foreground">{ann.footer}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="tickets-heading">
                <SectionHeading id="tickets-heading">Tickets</SectionHeading>
                <p className="text-sm text-muted-foreground">
                  {openTickets === 0 ? "You have no open tickets." : `You have ${openTickets} open ${openTickets === 1 ? "ticket" : "tickets"}.`}
                </p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link to="/student/tickets">{openTickets > 0 ? "See your tickets" : "Report broken equipment"}</Link>
                </Button>
              </section>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
};

export default StudentDashboard;
