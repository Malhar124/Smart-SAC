import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, qs } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { dateKey as toDateKey, formatClock, formatDay, formatDayClock, formatHour } from "@/lib/format";
import { upcomingDateKeys, parseDateKey, zonedTimeToDate } from "@/lib/time";
import { bookableHours, buildSlots, type Slot } from "@/lib/rooms";
import { ROOM_MAX_UPCOMING_BOOKINGS } from "@/lib/policy";
import type { Room, RoomBookingSummary, RoomsDay } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Field, fieldProps } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";

const DAYS_SHOWN = 8;

const dayLabel = (key: string, index: number) => {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return formatDay(zonedTimeToDate({ ...parseDateKey(key), hour: 12 }));
};

interface Pick {
  room: Room;
  slots: Slot[];
  index: number;
}

/** Slot styles: free is chalk, taken is court green, yours carries the court line, past and closed recede */
const slotClass: Record<Slot["state"], string> = {
  free: "bg-card border border-border hover:border-primary hover:bg-accent cursor-pointer",
  mine: "bg-card border-[3px] border-line",
  taken: "bg-court text-court-foreground",
  past: "bg-muted/50 text-muted-foreground/60",
  closed: "border border-dashed border-border text-muted-foreground",
};

const slotLabel: Record<Slot["state"], string> = { free: "free", mine: "booked by you", taken: "booked", past: "over", closed: "closed" };

const RoomsPage = () => {
  const queryClient = useQueryClient();
  const days = useMemo(() => upcomingDateKeys(DAYS_SHOWN), []);
  const [date, setDate] = useState(days[0]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [hours, setHours] = useState(1);
  const [purpose, setPurpose] = useState("");

  const roomsQuery = useQuery({
    queryKey: [...qk.rooms, date],
    queryFn: () => api.get<RoomsDay>(`/users/get-rooms${qs({ date })}`),
  });
  const mine = useQuery({ queryKey: qk.myRoomBookings, queryFn: () => api.get<RoomBookingSummary[]>("/users/get-my-room-bookings") });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.rooms });
    queryClient.invalidateQueries({ queryKey: qk.myRoomBookings });
    queryClient.invalidateQueries({ queryKey: qk.me });
  };

  const book = useMutation({
    mutationFn: (body: { roomId: string; startsAt: string; hours: number; purpose?: string }) => api.post("/users/book-room", body),
    onSuccess: () => {
      toast.success("Room booked", { description: "You'll get a reminder 15 minutes before it starts." });
      setPick(null);
    },
    onSettled: refresh,
  });

  const cancel = useMutation({
    mutationFn: (bookingId: string) => api.post(`/users/cancel-room-booking/${bookingId}`),
    onSuccess: () => toast.success("Booking cancelled"),
    onSettled: refresh,
  });

  const data = roomsQuery.data;
  const upcoming = mine.data ?? [];
  const atLimit = upcoming.length >= ROOM_MAX_UPCOMING_BOOKINGS;

  const openPicker = (room: Room, slots: Slot[], index: number) => {
    if (atLimit) {
      toast.error(`You can have ${ROOM_MAX_UPCOMING_BOOKINGS} upcoming bookings at a time. Cancel one first.`);
      return;
    }
    setPick({ room, slots, index });
    setHours(1);
    setPurpose("");
  };

  const maxHours = pick && data ? bookableHours(pick.slots, pick.index, data.maxHours) : 1;
  const chosen = pick?.slots[pick.index];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHeader
        title="Rooms"
        description={`Book a room in whole hours, up to ${data?.maxHours ?? 2} hours at a time and up to a week ahead.`}
      />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-6xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <section aria-labelledby="mine-heading" className="mb-10">
          <h2 id="mine-heading" className="type-heading text-xl mb-3">
            Your bookings
          </h2>
          {mine.isLoading ? (
            <ListSkeleton rows={1} />
          ) : upcoming.length === 0 ? (
            <p className="text-muted-foreground">No upcoming bookings. Pick a free slot below.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border max-w-3xl">
              {upcoming.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{b.room.name}</p>
                    <p className="text-sm text-muted-foreground tabular">
                      {formatDayClock(b.startsAt)} to {formatClock(b.endsAt)}
                      {b.purpose && <span>, {b.purpose}</span>}
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={cancel.isPending && cancel.variables === b.id}>
                        Cancel
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {b.room.name}, {formatDayClock(b.startsAt)}. The slot becomes free for others straight away.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => cancel.mutate(b.id)}>
                          Cancel booking
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          )}
          {atLimit && (
            <p className="mt-3 text-sm text-muted-foreground">You have {ROOM_MAX_UPCOMING_BOOKINGS} upcoming bookings, the most allowed at once.</p>
          )}
        </section>

        <section aria-labelledby="slots-heading">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-4">
            <h2 id="slots-heading" className="type-heading text-xl">
              {date === days[0] ? "Today" : formatDay(zonedTimeToDate({ ...parseDateKey(date), hour: 12 }))}
            </h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Choose a day">
              {days.map((key, i) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={date === key}
                  onClick={() => setDate(key)}
                  className={cn(
                    "h-8 px-3 rounded-md border text-sm font-medium tabular transition-colors",
                    date === key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  {dayLabel(key, i)}
                </button>
              ))}
            </div>
          </div>

          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground mb-4" aria-label="Key">
            <li className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm bg-card border border-border" aria-hidden />Free</li>
            <li className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm bg-court" aria-hidden />Booked</li>
            <li className="flex items-center gap-2"><span className="h-3 w-5 rounded-sm border-2 border-line" aria-hidden />Yours</li>
          </ul>

          {roomsQuery.error ? (
            <ErrorState title="Couldn't load rooms" error={roomsQuery.error} onRetry={() => roomsQuery.refetch()} />
          ) : roomsQuery.isLoading || !data ? (
            <ListSkeleton rows={4} rowClassName="h-16" />
          ) : data.rooms.length === 0 ? (
            <EmptyState title="No rooms to book yet">The SAC office adds bookable rooms. Check back later.</EmptyState>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <table className="w-full min-w-[60rem] table-fixed border-separate border-spacing-1 text-sm">
                <caption className="sr-only">Rooms and hourly slots for {date}</caption>
                <colgroup>
                  <col className="w-48" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="text-left font-medium text-muted-foreground pb-1 w-48">Room</th>
                    {Array.from({ length: data.closeHour - data.openHour }, (_, i) => data.openHour + i).map((h) => (
                      <th key={h} scope="col" className="font-normal text-xs text-muted-foreground pb-1 tabular">
                        {formatHour(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rooms.map((room) => {
                    const slots = buildSlots(room, data.date, data.openHour, data.closeHour);
                    return (
                      <tr key={room.id}>
                        <th scope="row" className="text-left font-normal align-middle pr-2">
                          <span className="block font-medium">{room.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {room.status === "maintenance" ? "Closed for now" : `Up to ${room.capacity} people`}
                          </span>
                        </th>
                        {slots.map((slot, i) => (
                          <td key={slot.hour} className="p-0">
                            {slot.state === "free" ? (
                              <button
                                type="button"
                                onClick={() => openPicker(room, slots, i)}
                                className={cn("h-11 w-full rounded-sm transition-colors", slotClass.free)}
                                aria-label={`${room.name}, ${formatHour(slot.hour)}, free. Book`}
                              />
                            ) : (
                              <div
                                className={cn("h-11 w-full rounded-sm", slotClass[slot.state])}
                                title={slot.booking?.purpose ?? undefined}
                                aria-label={`${room.name}, ${formatHour(slot.hour)}, ${slotLabel[slot.state]}`}
                                role="img"
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data && date === data.today && (
            <p className="mt-3 text-sm text-muted-foreground">Times are SAC time. Slots that have already ended are greyed out.</p>
          )}
        </section>
      </main>

      <Dialog open={Boolean(pick)} onOpenChange={(open) => !open && setPick(null)}>
        <DialogContent className="max-w-md">
          {pick && chosen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                book.mutate({ roomId: pick.room.id, startsAt: chosen.startsAt.toISOString(), hours, purpose: purpose.trim() || undefined });
              }}
              className="space-y-5"
            >
              <DialogHeader>
                <DialogTitle>Book the {pick.room.name}</DialogTitle>
                <DialogDescription>
                  {toDateKey(chosen.startsAt) === toDateKey() ? "Today" : formatDay(chosen.startsAt)}, from {formatClock(chosen.startsAt)} to{" "}
                  {formatClock(new Date(chosen.startsAt.getTime() + hours * 3_600_000))}
                </DialogDescription>
              </DialogHeader>

              <fieldset>
                <legend className="text-sm font-medium mb-2">How long</legend>
                <div className="inline-flex rounded-md border border-border p-0.5 bg-card">
                  {Array.from({ length: data?.maxHours ?? 2 }, (_, i) => i + 1).map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={hours === h}
                      disabled={h > maxHours}
                      onClick={() => setHours(h)}
                      className={cn(
                        "h-8 px-3 rounded-[calc(var(--radius)-2px)] text-sm font-medium transition-colors disabled:opacity-40",
                        hours === h ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {h} {h === 1 ? "hour" : "hours"}
                    </button>
                  ))}
                </div>
                {maxHours < (data?.maxHours ?? 2) && <p className="mt-2 text-sm text-muted-foreground">The next hour is taken or past closing.</p>}
              </fieldset>

              <Field id="purpose" label="What it's for (optional)" hint="Only you and SAC staff see this.">
                <Input {...fieldProps("purpose", undefined, true)} value={purpose} maxLength={120} onChange={(e) => setPurpose(e.target.value)} placeholder="Band practice" />
              </Field>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPick(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={book.isPending}>
                  {book.isPending ? "Booking…" : "Book room"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RoomsPage;
