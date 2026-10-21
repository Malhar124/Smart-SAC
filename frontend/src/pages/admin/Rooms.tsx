import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, qs } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatClock, formatDay } from "@/lib/format";
import { parseDateKey, upcomingDateKeys, zonedTimeToDate } from "@/lib/time";
import { roomSchema, serverFieldErrors, validate, type FieldErrors } from "@/lib/schemas";
import type { Room, RoomBooking, RoomsDay } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { Field, fieldProps } from "@/components/Field";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
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
const emptyRoom = { name: "", capacity: "", description: "" };

const RoomForm = ({ room, onDone }: { room?: Room; onDone: () => void }) => {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(room ? { name: room.name, capacity: String(room.capacity), description: room.description ?? "" } : emptyRoom);
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: (body: { name: string; capacity: number; description?: string }) =>
      room ? api.post(`/admin/update-room/${room.id}`, body) : api.post("/admin/add-room", body),
    onSuccess: () => {
      toast.success(room ? "Room saved" : "Room added");
      queryClient.invalidateQueries({ queryKey: qk.rooms });
      onDone();
    },
    onError: (e) => setErrors(serverFieldErrors(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(roomSchema, { ...values, capacity: values.capacity === "" ? NaN : Number(values.capacity) });
    setErrors(result.errors ?? {});
    if (result.data) save.mutate(result.data);
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field id="room-name" label="Name" error={errors.name}>
          <Input {...fieldProps("room-name", errors.name)} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} placeholder="Music Room" />
        </Field>
        <Field id="room-capacity" label="Capacity" error={errors.capacity}>
          <Input {...fieldProps("room-capacity", errors.capacity)} type="number" min={1} value={values.capacity} onChange={(e) => setValues({ ...values, capacity: e.target.value })} />
        </Field>
      </div>
      <Field id="room-description" label="Description (optional)" error={errors.description} hint="Shown to students when they book.">
        <Input
          {...fieldProps("room-description", errors.description, true)}
          value={values.description}
          onChange={(e) => setValues({ ...values, description: e.target.value })}
          placeholder="Keyboard, two guitars and a drum kit"
          maxLength={200}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : room ? "Save room" : "Add room"}
        </Button>
      </DialogFooter>
    </form>
  );
};

const AdminRooms = () => {
  const queryClient = useQueryClient();
  const days = useMemo(() => upcomingDateKeys(DAYS_SHOWN), []);
  const [date, setDate] = useState(days[0]);
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const [cancelling, setCancelling] = useState<{ room: Room; booking: RoomBooking } | null>(null);
  const [reason, setReason] = useState("");

  const rooms = useQuery({ queryKey: [...qk.rooms, "staff", date], queryFn: () => api.get<RoomsDay>(`/admin/get-rooms${qs({ date })}`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.rooms });

  const toggle = useMutation({
    mutationFn: (room: Room) => api.post(`/admin/update-room/${room.id}`, { status: room.status === "maintenance" ? "available" : "maintenance" }),
    onSuccess: (_d, room) => toast.success(room.status === "maintenance" ? `${room.name} reopened` : `${room.name} closed for booking`),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (roomId: string) => api.post(`/admin/remove-room/${roomId}`),
    onSuccess: () => toast.success("Room removed"),
    onSettled: refresh,
  });
  const cancelBooking = useMutation({
    mutationFn: ({ id, reason: why }: { id: string; reason: string }) => api.post(`/admin/cancel-room-booking/${id}`, { reason: why || undefined }),
    onSuccess: () => {
      toast.success("Booking cancelled", { description: "The student has been notified." });
      setCancelling(null);
      setReason("");
    },
    onSettled: refresh,
  });

  const data = rooms.data;

  return (
    <div className="min-h-screen bg-background">
      <Navbar role="admin" />
      <PageHeader
        title="Rooms"
        description="Who has which room, and when. Close a room to stop new bookings."
        actions={
          <Button variant="line" onClick={() => setEditing("new")}>
            Add a room
          </Button>
        }
      />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-6xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <div className="flex flex-wrap gap-1 mb-8" role="group" aria-label="Choose a day">
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
              {i === 0 ? "Today" : i === 1 ? "Tomorrow" : formatDay(zonedTimeToDate({ ...parseDateKey(key), hour: 12 }))}
            </button>
          ))}
        </div>

        {rooms.error ? (
          <ErrorState title="Couldn't load rooms" error={rooms.error} onRetry={() => rooms.refetch()} />
        ) : !data ? (
          <ListSkeleton rows={4} rowClassName="h-20" />
        ) : data.rooms.length === 0 ? (
          <EmptyState title="No rooms yet" action={<Button onClick={() => setEditing("new")}>Add a room</Button>}>
            Add the rooms students can book, like the music or drama room.
          </EmptyState>
        ) : (
          <div className="space-y-10">
            {data.rooms.map((room) => (
              <section key={room.id} aria-labelledby={`room-${room.id}`} className={cn(room.status === "maintenance" && "opacity-80")}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between mb-2">
                  <div>
                    <h2 id={`room-${room.id}`} className="type-heading text-xl">
                      {room.name}
                      {room.status === "maintenance" && <span className="ml-2 text-sm font-medium text-destructive">Closed</span>}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Up to {room.capacity} people{room.description ? `. ${room.description}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(room)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle.mutate(room)} disabled={toggle.isPending && toggle.variables?.id === room.id}>
                      {room.status === "maintenance" ? "Reopen" : "Close"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive">
                          Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove the {room.name}?</AlertDialogTitle>
                          <AlertDialogDescription>Upcoming bookings are cancelled and those students are notified. This can't be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep it</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => remove.mutate(room.id)}>
                            Remove room
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                {room.bookings.length === 0 ? (
                  <p className="text-sm text-muted-foreground border-y border-border py-3">No bookings this day.</p>
                ) : (
                  <ul className="divide-y divide-border border-y border-border">
                    {room.bookings.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p className="tabular font-medium">
                            {formatClock(b.startsAt)} to {formatClock(b.endsAt)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {b.student ? `${b.student.name} (${b.student.rollNo})` : "A student"}
                            {b.purpose && `, ${b.purpose}`}
                          </p>
                        </div>
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setCancelling({ room, booking: b })}>
                          Cancel booking
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </main>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" || editing === null ? "Add a room" : `Edit the ${editing.name}`}</DialogTitle>
            <DialogDescription>Students book it in whole hours during opening hours.</DialogDescription>
          </DialogHeader>
          {editing !== null && <RoomForm room={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent className="max-w-md">
          {cancelling && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                cancelBooking.mutate({ id: cancelling.booking.id, reason: reason.trim() });
              }}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>Cancel this booking?</DialogTitle>
                <DialogDescription>
                  {cancelling.room.name}, {formatClock(cancelling.booking.startsAt)} to {formatClock(cancelling.booking.endsAt)}
                  {cancelling.booking.student && ` for ${cancelling.booking.student.name}`}. They get a notification.
                </DialogDescription>
              </DialogHeader>
              <Field id="cancel-reason" label="Reason (optional)" hint="Included in the student's notification.">
                <Input {...fieldProps("cancel-reason", undefined, true)} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Floor cleaning" maxLength={200} />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCancelling(null)}>
                  Keep it
                </Button>
                <Button type="submit" variant="destructive" disabled={cancelBooking.isPending}>
                  {cancelBooking.isPending ? "Cancelling…" : "Cancel booking"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminRooms;
