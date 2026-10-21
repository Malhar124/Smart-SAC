import { Button } from "@/components/ui/button";
import { formatClock, formatDue, STATUS_WORD } from "@/lib/format";
import type { EquipmentItem, EquipmentStatus, StaffEquipmentItem, StudentEquipmentItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const statusDot: Record<EquipmentStatus, string> = {
  available: "bg-success",
  in_use: "bg-line",
  broken: "bg-destructive",
};

/** "Free", "Out" or "Broken" with its colour dot; "Reserved" when a free item is held */
export const EquipmentStatusLabel = ({ status, reserved = false }: { status: EquipmentStatus; reserved?: boolean }) => (
  <span className={cn("inline-flex items-center gap-2 text-sm whitespace-nowrap", status === "broken" ? "text-destructive" : "text-foreground")}>
    <span className={cn("h-2 w-2 rounded-full shrink-0", reserved ? "bg-line ring-2 ring-line/30" : statusDot[status])} aria-hidden />
    {reserved ? "Reserved" : STATUS_WORD[status]}
  </span>
);

const DueText = ({ item, className }: { item: EquipmentItem; className?: string }) =>
  item.dueAt ? (
    <span className={cn("tabular", item.overdue ? "text-destructive font-medium" : "text-muted-foreground", className)}>{formatDue(item.dueAt)}</span>
  ) : null;

const HolderText = ({ item }: { item: StaffEquipmentItem }) => {
  if (item.status === "in_use" && item.holder) {
    return (
      <span className="flex flex-col">
        <span>
          {item.holder.name ?? item.holder.rollNo ?? "Not recorded"}
          {item.holder.name && item.holder.rollNo && <span className="text-muted-foreground"> ({item.holder.rollNo})</span>}
        </span>
        {item.holder.phone && (
          <a href={`tel:${item.holder.phone}`} className="text-sm text-muted-foreground tabular hover:text-primary w-fit">
            {item.holder.phone}
          </a>
        )}
      </span>
    );
  }
  if (item.reservation) {
    return (
      <span className="flex flex-col">
        <span>Held for {item.reservation.name ?? item.reservation.rollNo}</span>
        <span className="text-sm text-muted-foreground tabular">until {formatClock(item.reservation.until)}</span>
      </span>
    );
  }
  return <span className="text-muted-foreground">None</span>;
};

/** The staff view of every item as a table (stacked rows on narrow screens) */
const EquipmentRegister = ({ items }: { items: StaffEquipmentItem[] }) => (
  <>
    <ul className="md:hidden divide-y divide-border border-y border-border">
      {items.map((item) => (
        <li key={item.id} className="py-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-medium capitalize">{item.name}</span>
            <EquipmentStatusLabel status={item.status} reserved={Boolean(item.reservation)} />
          </div>
          {(item.status === "in_use" || item.reservation) && (
            <div className="mt-1 flex items-start justify-between gap-4 text-sm">
              <HolderText item={item} />
              <DueText item={item} className="shrink-0" />
            </div>
          )}
        </li>
      ))}
    </ul>

    <table className="hidden md:table w-full text-left border-collapse">
      <caption className="sr-only">Equipment, status, who has it and when it's due</caption>
      <thead>
        <tr className="border-b border-border text-sm text-muted-foreground">
          <th scope="col" className="py-2 pr-4 font-medium">Equipment</th>
          <th scope="col" className="py-2 pr-4 font-medium w-32">Status</th>
          <th scope="col" className="py-2 pr-4 font-medium">With</th>
          <th scope="col" className="py-2 font-medium w-44 text-right">Due</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className={cn("border-b border-border align-top", item.overdue && "bg-destructive/5")}>
            <td className="py-3 pr-4 font-medium capitalize">{item.name}</td>
            <td className="py-3 pr-4">
              <EquipmentStatusLabel status={item.status} reserved={Boolean(item.reservation)} />
            </td>
            <td className="py-3 pr-4">
              <HolderText item={item} />
            </td>
            <td className="py-3 text-right">
              <DueText item={item} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </>
);

export default EquipmentRegister;

/** One sentence describing a tag, read by screen readers in place of the visual layout */
const describeTag = (item: StudentEquipmentItem, hold: StudentEquipmentItem["reservation"]) => {
  if (hold?.mine) return `${item.name}: held for you until ${formatClock(hold.until)}.`;
  if (hold) return `${item.name}: reserved until ${formatClock(hold.until)}.`;
  if (item.status === "available") return `${item.name}: free.`;
  if (item.status === "broken") return `${item.name}: broken.`;
  const who = item.holder?.name ?? item.holder?.rollNo ?? "someone";
  return `${item.name}: out with ${who}. ${item.dueAt ? formatDue(item.dueAt) : ""}`;
};

interface RackProps {
  items: StudentEquipmentItem[];
  onReserve?: (id: string) => void;
  onCancel?: (id: string) => void;
  /** Item whose reserve/cancel request is in flight */
  pendingId?: string | null;
  /** Whether this student already holds something (only one hold at a time) */
  holdingSomething?: boolean;
  /** Borrowing is blocked: Reserve buttons are disabled with this reason */
  blockedReason?: string | null;
  /** The signed-in student's roll number, to mark items they have out */
  myRollNo?: string;
}

/**
 * The desk's rack as tags: free items are chalk white, items out are court green with who has
 * them and when they're due, broken items are taped off with a dashed clay border. A free item
 * held by this student gets the yellow court-line border.
 */
export const EquipmentRack = ({ items, onReserve, onCancel, pendingId, holdingSomething, blockedReason, myRollNo }: RackProps) => (
  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
    {items.map((item) => {
      const hold = item.status === "available" ? item.reservation : null;
      const pending = pendingId === item.id;
      const mineOut = item.status === "in_use" && myRollNo && item.holder?.rollNo === myRollNo;
      const reserveDisabledReason = blockedReason ?? (holdingSomething ? "You can hold one item at a time" : null);
      return (
        <li
          key={item.id}
          aria-label={describeTag(item, hold)}
          className={cn(
            "flex min-h-[7rem] flex-col justify-between gap-3 rounded-md p-4",
            item.status === "available" && !hold && "bg-card border border-border",
            hold?.mine && "bg-card border-[3px] border-line",
            hold && !hold.mine && "bg-card/60 border border-border text-muted-foreground",
            item.status === "in_use" && "bg-court text-court-foreground",
            item.status === "in_use" && item.overdue && "ring-2 ring-destructive ring-offset-2 ring-offset-background",
            item.status === "broken" && "border-2 border-dashed border-destructive/70 text-muted-foreground"
          )}
        >
          <span className="type-heading text-lg leading-tight capitalize" aria-hidden>
            {item.name}
          </span>

          {item.status === "available" && !hold && (
            <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2" aria-hidden>
                <span className="h-2 w-2 rounded-full bg-success" />
                Free
              </span>
              {onReserve && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={pending || Boolean(reserveDisabledReason)}
                  title={reserveDisabledReason ?? undefined}
                  onClick={() => onReserve(item.id)}
                  aria-label={`Reserve ${item.name}`}
                >
                  {pending ? "Reserving…" : "Reserve"}
                </Button>
              )}
            </span>
          )}

          {hold?.mine && (
            <span className="flex flex-col gap-2 text-sm">
              <span aria-hidden>
                <span className="font-medium">Held for you</span>
                <span className="block text-muted-foreground tabular">Collect by {formatClock(hold.until)}</span>
              </span>
              {onCancel && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-fit -ml-2 text-muted-foreground"
                  disabled={pending}
                  onClick={() => onCancel(item.id)}
                  aria-label={`Cancel reservation for ${item.name}`}
                >
                  {pending ? "Cancelling…" : "Cancel"}
                </Button>
              )}
            </span>
          )}

          {hold && !hold.mine && (
            <span className="text-sm" aria-hidden>
              Reserved until {formatClock(hold.until)}
            </span>
          )}

          {item.status === "broken" && (
            <span className="text-sm text-destructive" aria-hidden>
              Broken
            </span>
          )}
          {item.status === "in_use" && (
            <span className="text-sm text-court-muted" aria-hidden={!item.holder?.phone}>
              <span className="block text-court-foreground">{mineOut ? "You have it" : item.holder?.name ?? item.holder?.rollNo ?? "Out"}</span>
              {item.dueAt && (
                <span className={cn("block tabular", item.overdue && "text-court-line font-medium")}>{formatDue(item.dueAt)}</span>
              )}
              {!mineOut && item.holder?.phone && (
                <a href={`tel:${item.holder.phone}`} className="tabular underline-offset-4 hover:underline hover:text-court-foreground" aria-label={`Call ${item.holder.name ?? "them"}`}>
                  {item.holder.phone}
                </a>
              )}
            </span>
          )}
        </li>
      );
    })}
  </ul>
);
