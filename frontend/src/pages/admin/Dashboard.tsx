import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatClock, formatDayClock, formatMinutes, normalizeStatus } from "@/lib/format";
import type { HistoryEntry, StaffDashboard, StaffEquipmentItem } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import EquipmentRegister, { EquipmentStatusLabel } from "@/components/EquipmentRegister";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { LendHoldDialog } from "@/components/LendHoldDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const SectionHeading = ({ id, children, to, linkText }: { id: string; children: string; to?: string; linkText?: string }) => (
  <div className="flex items-baseline justify-between gap-4 mb-3">
    <h2 id={id} className="type-heading text-xl">
      {children}
    </h2>
    {to && (
      <Link to={to} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        {linkText}
      </Link>
    )}
  </div>
);

// Items that need the desk come first: overdue, out, held, broken, then free
const attentionOrder = (item: StaffEquipmentItem) =>
  item.overdue ? 0 : item.status === "in_use" ? 1 : item.reservation ? 2 : item.status === "broken" ? 3 : 4;

const AdminDashboard = () => {
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: qk.staffDashboard, queryFn: () => api.get<StaffDashboard>("/admin/dashboard") });
  const equipment = useQuery({ queryKey: qk.staffEquipment, queryFn: () => api.get<StaffEquipmentItem[]>("/admin/get-equipment") });
  const history = useQuery({ queryKey: qk.recentHistory, queryFn: () => api.get<HistoryEntry[]>("/admin/get-recent-equipment-history") });

  const [lending, setLending] = useState<StaffEquipmentItem | null>(null);

  const release = useMutation({
    mutationFn: (equipmentId: string) => api.post("/admin/release-reservation", { equipmentId }),
    onSuccess: () => toast.success("Hold released", { description: "The student has been notified." }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.staffDashboard });
      queryClient.invalidateQueries({ queryKey: qk.staffEquipment });
    },
  });

  const markReturned = useMutation({
    mutationFn: (equipmentId: string) => api.post<{ late: boolean }>("/admin/return-equipment", { equipmentId }),
    onSuccess: (result) => toast.success(result.late ? "Marked returned (late)" : "Marked returned"),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.staffDashboard });
      queryClient.invalidateQueries({ queryKey: qk.staffEquipment });
    },
  });

  const counts = dashboard.data?.counts;
  const overdue = dashboard.data?.overdue ?? [];
  const announcements = dashboard.data?.announcements ?? [];
  const items = [...(equipment.data ?? [])].sort((a, b) => attentionOrder(a) - attentionOrder(b));
  // Students who reserved online and are on their way to the desk, soonest-expiring first
  const holds = items
    .filter((i) => i.reservation)
    .sort((a, b) => (a.reservation!.until < b.reservation!.until ? -1 : 1));

  const tally = [
    { label: "Out now", value: counts?.out },
    { label: "Overdue", value: counts?.overdue, alert: (counts?.overdue ?? 0) > 0 },
    { label: "Held", value: counts?.reserved, to: "#holds" },
    { label: "Free", value: counts?.free },
    { label: "Broken", value: counts?.broken, to: "/admin/equipment" },
    { label: "Open tickets", value: counts?.openTickets, to: "/admin/tickets" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar role="admin" />
      <PageHeader
        title="SAC desk"
        description={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        actions={
          <Button asChild variant="line">
            <Link to="/admin/lend">Lend equipment</Link>
          </Button>
        }
      />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-6xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <dl className="grid grid-cols-3 sm:grid-cols-6 border-y border-border mb-10">
          {tally.map((t) => (
            <div key={t.label} className="py-4 pr-4">
              <dt className="text-sm text-muted-foreground">
                {t.to?.startsWith("#") ? (
                  <a href={t.to} className="underline-offset-4 hover:underline hover:text-foreground">
                    {t.label}
                  </a>
                ) : t.to ? (
                  <Link to={t.to} className="underline-offset-4 hover:underline hover:text-foreground">
                    {t.label}
                  </Link>
                ) : (
                  t.label
                )}
              </dt>
              <dd className={cn("type-title text-4xl tabular mt-1", t.alert && "text-destructive")}>{t.value ?? "–"}</dd>
            </div>
          ))}
        </dl>

        {dashboard.error && <ErrorState title="Couldn't load the desk" error={dashboard.error} onRetry={() => dashboard.refetch()} className="mb-10" />}

        {overdue.length > 0 && (
          <section aria-labelledby="overdue-heading" className="mb-12">
            <SectionHeading id="overdue-heading">Overdue</SectionHeading>
            <ul className="divide-y divide-border border-y border-border">
              {overdue.map((loan) => (
                <li key={loan.loanId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between border-l-4 !border-l-destructive pl-3">
                  <div className="min-w-0">
                    <p className="font-medium capitalize">{loan.equipmentName}</p>
                    <p className="text-sm text-muted-foreground">
                      {loan.name ? `${loan.name} (${loan.rollNo})` : loan.rollNo}
                      {loan.phone && (
                        <>
                          {", "}
                          <a href={`tel:${loan.phone}`} className="tabular hover:text-primary">
                            {loan.phone}
                          </a>
                        </>
                      )}
                    </p>
                    <p className="text-sm text-destructive tabular">
                      Overdue by {formatMinutes(loan.minutesOverdue)}, due {formatDayClock(loan.dueAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 w-fit"
                    disabled={markReturned.isPending && markReturned.variables === loan.equipmentId}
                    onClick={() => markReturned.mutate(loan.equipmentId)}
                  >
                    Mark returned
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section id="holds" aria-labelledby="holds-heading" className="mb-12 scroll-mt-24">
          <SectionHeading id="holds-heading">Waiting to collect</SectionHeading>
          <p className="-mt-2 mb-3 text-sm text-muted-foreground">Students who reserved online. When they arrive, check their ID and lend it.</p>
          {equipment.isLoading ? (
            <ListSkeleton rows={2} />
          ) : holds.length === 0 ? (
            <p className="text-sm text-muted-foreground border-y border-border py-3">No one is on their way to collect anything.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {holds.map((item) => (
                <li key={item.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between border-l-4 !border-l-line pl-3">
                  <div className="min-w-0">
                    <p className="font-medium capitalize">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.reservation!.name} ({item.reservation!.rollNo}), held until{" "}
                      <span className="tabular">{formatClock(item.reservation!.until)}</span>
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" onClick={() => setLending(item)}>
                      Lend
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={release.isPending && release.variables === item.id}>
                          Release
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Release this hold?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The {item.name} becomes free for anyone, and {item.reservation!.name} gets a notification.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep the hold</AlertDialogCancel>
                          <AlertDialogAction onClick={() => release.mutate(item.id)}>Release hold</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby="equipment-heading" className="min-w-0">
            <SectionHeading id="equipment-heading" to="/admin/equipment" linkText="Manage equipment">
              Equipment
            </SectionHeading>
            {equipment.error ? (
              <ErrorState title="Couldn't load equipment" error={equipment.error} onRetry={() => equipment.refetch()} />
            ) : equipment.isLoading ? (
              <ListSkeleton rows={6} rowClassName="h-10" />
            ) : items.length === 0 ? (
              <EmptyState
                title="No equipment yet"
                action={
                  <Button asChild size="sm">
                    <Link to="/admin/equipment">Add equipment</Link>
                  </Button>
                }
              >
                Add games and their equipment so students can see what's free.
              </EmptyState>
            ) : (
              <EquipmentRegister items={items} />
            )}
          </section>

          <aside className="space-y-10" aria-label="Activity">
            <section aria-labelledby="history-heading">
              <SectionHeading id="history-heading" to="/admin/history" linkText="Full history">
                Recent changes
              </SectionHeading>
              {history.isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (history.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing has changed hands yet.</p>
              ) : (
                <ol className="space-y-4">
                  {(history.data ?? []).map((item) => (
                    <li key={item.id} className="text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium capitalize truncate">{item.equipment?.name}</span>
                        <EquipmentStatusLabel status={normalizeStatus(item.status)} />
                      </div>
                      <p className="text-muted-foreground">
                        {item.student ? `${item.student.name} (${item.student.rollNo}), ` : item.rollNo ? `${item.rollNo}, ` : ""}
                        <time dateTime={item.changedAt} className="tabular">
                          {formatDayClock(item.changedAt)}
                        </time>
                        {item.staff && <span>, by {item.staff}</span>}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="announcements-heading">
              <SectionHeading id="announcements-heading" to="/admin/announcements" linkText="Post or remove">
                Announcements
              </SectionHeading>
              {dashboard.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : announcements.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing posted right now.</p>
              ) : (
                <ul className="space-y-5">
                  {announcements.map((item) => (
                    <li key={item.id} className="border-l-[3px] border-primary pl-3">
                      <p className="font-medium leading-snug">{item.heading}</p>
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{item.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </main>

      <LendHoldDialog item={lending} onClose={() => setLending(null)} />
    </div>
  );
};

export default AdminDashboard;
