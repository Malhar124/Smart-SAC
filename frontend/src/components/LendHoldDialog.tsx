import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, isApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatClock, formatDue, formatMinutes } from "@/lib/format";
import { LEND_PRESETS } from "@/lib/policy";
import type { StaffEquipmentItem, StudentSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  /** A free item with a student's hold on it; null closes the dialog */
  item: StaffEquipmentItem | null;
  onClose: () => void;
}

/**
 * The student who reserved an item is at the desk: check their ID against the name and roll number,
 * pick how long, and lend it. Everyone's rack and desk update straight away.
 */
export const LendHoldDialog = ({ item, onClose }: Props) => {
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState(60);
  const [override, setOverride] = useState(false);
  const rollNo = item?.reservation?.rollNo ?? "";

  useEffect(() => {
    if (item) {
      setDuration(60);
      setOverride(false);
    }
  }, [item]);

  const summary = useQuery({
    queryKey: qk.studentSummary(rollNo),
    queryFn: () => api.get<StudentSummary>(`/admin/get-student/${encodeURIComponent(rollNo)}`),
    enabled: Boolean(item && rollNo),
  });

  const lend = useMutation({
    mutationFn: () =>
      api.post<{ loan: { dueAt: string }; overrodeBlock: boolean }>("/admin/lend-equipment", {
        equipmentId: item!.id,
        rollNo,
        durationMinutes: duration,
        overrideBlock: override,
      }),
    onSuccess: (result) => {
      toast.success(`Lent the ${item!.name} to ${item!.reservation?.name ?? rollNo}`, {
        description: `Due back at ${formatClock(result.loan.dueAt)}${result.overrodeBlock ? ". Block override recorded." : "."}`,
      });
      onClose();
    },
    onError: (error) => {
      // A block is shown in the dialog with the override option, so no toast for that one
      if (!(isApiError(error) && error.code === "BORROWING_BLOCKED")) toast.error(error instanceof Error ? error.message : "Couldn't lend it. Try again.");
      queryClient.invalidateQueries({ queryKey: qk.studentSummary(rollNo) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.staffEquipment });
      queryClient.invalidateQueries({ queryKey: qk.staffDashboard });
      queryClient.invalidateQueries({ queryKey: qk.studentSummaryAll });
    },
    meta: { silent: true },
  });

  const blocked = Boolean(summary.data?.standing.blocked);
  const dueAt = new Date(Date.now() + duration * 60_000);

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {item?.reservation && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (blocked && !override) return;
              lend.mutate();
            }}
            className="space-y-5"
          >
            <DialogHeader>
              <DialogTitle className="first-letter:uppercase">Lend the {item.name}</DialogTitle>
              <DialogDescription>Check their ID card matches before handing it over.</DialogDescription>
            </DialogHeader>

            <div className={cn("rounded-md border p-4 space-y-2", blocked ? "border-destructive bg-destructive/5" : "border-border bg-card")}>
              <p className="font-medium">
                {item.reservation.name} <span className="text-muted-foreground tabular">({item.reservation.rollNo})</span>
              </p>
              <p className="text-sm text-muted-foreground">Held until {formatClock(item.reservation.until)}</p>
              {summary.isLoading ? (
                <Skeleton className="h-4 w-2/3" />
              ) : summary.data ? (
                <>
                  {blocked ? (
                    <p className="text-sm">
                      <span className="font-medium text-destructive">Borrowing blocked.</span> {summary.data.standing.message}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {summary.data.standing.lateReturns === 0
                        ? "No late returns"
                        : `${summary.data.standing.lateReturns} late ${summary.data.standing.lateReturns === 1 ? "return" : "returns"}`}{" "}
                      in the last {summary.data.standing.windowDays} days.
                    </p>
                  )}
                  {summary.data.activeLoans.length > 0 && (
                    <ul className="text-sm text-muted-foreground">
                      {summary.data.activeLoans.map((l) => (
                        <li key={l.id} className="flex justify-between gap-3">
                          <span>
                            Has the <span className="capitalize">{l.equipment.name}</span>
                          </span>
                          <span className={cn("tabular", l.overdue && "text-destructive font-medium")}>{formatDue(l.dueAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
            </div>

            <fieldset>
              <legend className="text-sm font-medium mb-2">For how long</legend>
              <div className="flex flex-wrap gap-2">
                {LEND_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    aria-pressed={duration === minutes}
                    onClick={() => setDuration(minutes)}
                    className={cn(
                      "h-8 px-3 rounded-md border text-sm tabular transition-colors",
                      duration === minutes ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {formatMinutes(minutes)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Due back at <span className="text-foreground tabular">{formatClock(dueAt)}</span>
              </p>
            </fieldset>

            {blocked && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} className="mt-0.5" />
                <span>Lend anyway. The override is recorded against your name.</span>
              </label>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={lend.isPending || (blocked && !override)} autoFocus>
                {lend.isPending ? "Lending…" : "Lend it"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
