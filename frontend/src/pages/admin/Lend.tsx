import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import { toast } from "sonner";
import { ScanLine } from "lucide-react";
import { api, isApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatClock, formatDue, formatMinutes } from "@/lib/format";
import { LEND_PRESETS } from "@/lib/policy";
import { lendSchema, rollNo as rollRule, validate, type FieldErrors } from "@/lib/schemas";
import type { StaffEquipmentItem, StudentSummary } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { ScanIdDialog } from "@/components/ScanIdDialog";
import { LendHoldDialog } from "@/components/LendHoldDialog";
import { Field, fieldProps } from "@/components/Field";
import { EmptyState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/** What the desk knows about a roll number before lending */
const StudentPanel = ({ summary, onLendHeld }: { summary: StudentSummary; onLendHeld: (equipmentId: string) => void }) => {
  const { student, standing } = summary;
  return (
    <div className={cn("rounded-md border p-4 space-y-3", standing.blocked ? "border-destructive bg-destructive/5" : "border-border bg-card")} aria-live="polite">
      <div>
        <p className="font-medium">{student ? student.fullname : summary.rollNo}</p>
        <p className="text-sm text-muted-foreground">
          {student ? (
            <>
              {student.roll_no}
              {student.phone_number && (
                <>
                  {", "}
                  <a href={`tel:${student.phone_number}`} className="tabular hover:text-primary">
                    {student.phone_number}
                  </a>
                </>
              )}
            </>
          ) : (
            "No Smart SAC account for this roll number. You can still lend; they just won't get reminders."
          )}
        </p>
      </div>

      {standing.blocked ? (
        <p className="text-sm">
          <span className="font-medium text-destructive">Borrowing blocked.</span> {standing.message}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {standing.lateReturns === 0 ? "No late returns" : `${standing.lateReturns} late ${standing.lateReturns === 1 ? "return" : "returns"}`} in the last{" "}
          {standing.windowDays} days.
        </p>
      )}

      {summary.activeLoans.length > 0 && (
        <div>
          <p className="text-sm font-medium">Has out now</p>
          <ul className="text-sm text-muted-foreground">
            {summary.activeLoans.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className="capitalize">{l.equipment.name}</span>
                <span className={cn("tabular", l.overdue && "text-destructive font-medium")}>{formatDue(l.dueAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.reservation && (
        <div className="flex items-center justify-between gap-3 border-l-[3px] border-line pl-3">
          <p className="text-sm">
            Holding the <span className="capitalize font-medium">{summary.reservation.equipmentName}</span> until {formatClock(summary.reservation.until)}
          </p>
          <Button size="sm" variant="outline" onClick={() => onLendHeld(summary.reservation!.equipmentId)}>
            Choose it
          </Button>
        </div>
      )}
    </div>
  );
};

const LendPage = () => {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const rollInput = useRef<HTMLInputElement>(null);
  const itemSearch = useRef<HTMLInputElement>(null);

  const [roll, setRoll] = useState(params.get("roll") ?? "");
  const [lookupRoll, setLookupRoll] = useState<string | null>(null);
  const [equipmentId, setEquipmentId] = useState(params.get("equipment") ?? "");
  const [itemQuery, setItemQuery] = useState("");
  const [duration, setDuration] = useState<number>(60);
  const [override, setOverride] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [scanOpen, setScanOpen] = useState(false);
  const [lendingHold, setLendingHold] = useState<StaffEquipmentItem | null>(null);

  const equipment = useQuery({ queryKey: qk.staffEquipment, queryFn: () => api.get<StaffEquipmentItem[]>("/admin/get-equipment") });
  const summary = useQuery({
    queryKey: qk.studentSummary(lookupRoll ?? ""),
    queryFn: () => api.get<StudentSummary>(`/admin/get-student/${encodeURIComponent(lookupRoll!)}`),
    enabled: Boolean(lookupRoll),
  });

  const lookUp = useCallback((value: string) => {
    const result = validate(rollRule, value);
    if (result.data) {
      setLookupRoll(result.data);
      setRoll(result.data);
      setOverride(false);
      setErrors((e) => ({ ...e, rollNo: "" }));
      return true;
    }
    setErrors((e) => ({ ...e, rollNo: result.errors?.[""] ?? "Enter a roll number" }));
    return false;
  }, []);

  // Arriving from the command palette with ?roll= looks the student up straight away
  useEffect(() => {
    const fromUrl = params.get("roll");
    if (fromUrl) lookUp(fromUrl);
    // Only on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keys 1-4 pick a duration when you're not typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const index = Number(e.key) - 1;
      if (index >= 0 && index < LEND_PRESETS.length) setDuration(LEND_PRESETS[index]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = useMemo(() => equipment.data ?? [], [equipment.data]);
  const lendable = useMemo(() => {
    const heldForThisStudent = summary.data?.reservation?.equipmentId;
    return items.filter((i) => i.status === "available" && (!i.reservation || i.id === heldForThisStudent || i.reservation.rollNo === lookupRoll));
  }, [items, summary.data, lookupRoll]);
  const visibleItems = lendable.filter((i) => !itemQuery.trim() || i.name.toLowerCase().includes(itemQuery.trim().toLowerCase()));
  const holds = items.filter((i) => i.reservation);
  const out = items.filter((i) => i.status === "in_use").sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  const chosen = items.find((i) => i.id === equipmentId);
  const blocked = Boolean(summary.data?.standing.blocked);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.staffEquipment });
    queryClient.invalidateQueries({ queryKey: qk.staffDashboard });
    queryClient.invalidateQueries({ queryKey: qk.studentSummaryAll });
  };

  const resetForm = () => {
    setRoll("");
    setLookupRoll(null);
    setEquipmentId("");
    setItemQuery("");
    setOverride(false);
    setErrors({});
    if (params.toString()) setParams({}, { replace: true });
    rollInput.current?.focus();
  };

  const lend = useMutation({
    mutationFn: (body: { equipmentId: string; rollNo: string; durationMinutes: number; overrideBlock: boolean }) =>
      api.post<{ loan: { dueAt: string }; student: { fullname: string } | null; overrodeBlock: boolean }>("/admin/lend-equipment", body),
    onSuccess: (result, body) => {
      const name = chosen?.name ?? "item";
      toast.success(`Lent the ${name} to ${result.student?.fullname ?? body.rollNo}`, {
        description: `Due back at ${formatClock(result.loan.dueAt)}${result.overrodeBlock ? ". Block override recorded." : "."}`,
      });
      resetForm();
    },
    onError: (error) => {
      if (isApiError(error) && error.code === "BORROWING_BLOCKED") queryClient.invalidateQueries({ queryKey: qk.studentSummaryAll });
    },
    onSettled: refresh,
  });

  const markReturned = useMutation({
    mutationFn: (id: string) => api.post<{ late: boolean }>("/admin/return-equipment", { equipmentId: id }),
    onSuccess: (result) => toast.success(result.late ? "Marked returned (late)" : "Marked returned"),
    onSettled: refresh,
  });

  const release = useMutation({
    mutationFn: (id: string) => api.post("/admin/release-reservation", { equipmentId: id }),
    onSuccess: () => toast.success("Hold released"),
    onSettled: refresh,
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const result = validate(lendSchema, { rollNo: roll, equipmentId, durationMinutes: duration });
    setErrors(result.errors ?? {});
    if (!result.data) {
      if (result.errors?.rollNo) rollInput.current?.focus();
      else if (result.errors?.equipmentId) itemSearch.current?.focus();
      return;
    }
    if (blocked && !override) {
      setErrors({ override: "This student is blocked. Tick “Lend anyway” to override." });
      return;
    }
    lend.mutate({ ...result.data, overrideBlock: blocked && override });
  };

  const handleScanned = useCallback(
    (value: string) => {
      setRoll(value);
      lookUp(value);
      setTimeout(() => itemSearch.current?.focus(), 0);
    },
    [lookUp]
  );

  const dueAt = new Date(Date.now() + duration * 60_000);

  return (
    <div className="min-h-screen bg-background">
      <Navbar role="admin" />
      <PageHeader title="Lend & return" width="max-w-6xl" />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-6xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <div className="grid gap-12 lg:grid-cols-[26rem_minmax(0,1fr)]">
          <section aria-labelledby="lend-heading">
            <h2 id="lend-heading" className="type-heading text-xl mb-1">
              Lend equipment
            </h2>
            <p className="text-sm text-muted-foreground mb-5">Scan or type the roll number, pick the item, press Enter.</p>

            <form onSubmit={submit} className="space-y-5" noValidate>
              <Field id="rollNo" label="Student roll number" error={errors.rollNo}>
                <div className="flex gap-2">
                  <Input
                    ref={rollInput}
                    {...fieldProps("rollNo", errors.rollNo)}
                    value={roll}
                    onChange={(e) => {
                      setRoll(e.target.value);
                      if (lookupRoll) setLookupRoll(null);
                    }}
                    onKeyDown={(e) => {
                      // Barcode scanners type the number and press Enter: look the student up, then move on
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (lookUp(roll)) itemSearch.current?.focus();
                      }
                    }}
                    onBlur={() => roll.trim() && !lookupRoll && lookUp(roll)}
                    placeholder="IIT2023042"
                    autoComplete="off"
                    autoFocus
                    className="tabular uppercase placeholder:normal-case"
                  />
                  <Button type="button" variant="outline" onClick={() => setScanOpen(true)} aria-label="Scan student ID with the camera">
                    <ScanLine />
                    <span className="hidden sm:inline">Scan ID</span>
                  </Button>
                </div>
              </Field>

              {lookupRoll &&
                (summary.isLoading ? (
                  <ListSkeleton rows={1} rowClassName="h-24" />
                ) : summary.data ? (
                  <StudentPanel summary={summary.data} onLendHeld={(id) => setEquipmentId(id)} />
                ) : null)}

              <div className="space-y-2">
                <label htmlFor="item-search" className="text-sm font-medium leading-none">
                  Item
                </label>
                <CommandPrimitive shouldFilter={false} loop className="rounded-md border border-input bg-background" label="Choose an item">
                  <CommandPrimitive.Input
                    ref={itemSearch}
                    id="item-search"
                    value={itemQuery}
                    onValueChange={setItemQuery}
                    placeholder={chosen ? `Chosen: ${chosen.name}` : "Type to filter free items"}
                    className="flex h-10 w-full bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground border-b border-border"
                    aria-invalid={errors.equipmentId ? true : undefined}
                    aria-describedby={errors.equipmentId ? "equipmentId-error" : undefined}
                  />
                  <CommandPrimitive.List className="max-h-52 overflow-y-auto p-1">
                    {equipment.isLoading ? (
                      <p className="px-2 py-3 text-sm text-muted-foreground">Loading…</p>
                    ) : visibleItems.length === 0 ? (
                      <p className="px-2 py-3 text-sm text-muted-foreground">{lendable.length === 0 ? "Nothing is free right now." : "No free item matches that."}</p>
                    ) : (
                      visibleItems.map((item) => (
                        <CommandPrimitive.Item
                          key={item.id}
                          value={item.id}
                          onSelect={() => {
                            setEquipmentId(item.id);
                            setItemQuery("");
                            setErrors((e) => ({ ...e, equipmentId: "" }));
                          }}
                          className={cn(
                            "flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-2 text-sm outline-none data-[selected=true]:bg-accent",
                            equipmentId === item.id && "font-semibold"
                          )}
                        >
                          <span className="capitalize">{item.name}</span>
                          {equipmentId === item.id ? <span className="text-primary">Chosen</span> : item.reservation ? <span className="text-muted-foreground">Their hold</span> : null}
                        </CommandPrimitive.Item>
                      ))
                    )}
                  </CommandPrimitive.List>
                </CommandPrimitive>
                {errors.equipmentId && (
                  <p id="equipmentId-error" className="text-sm text-destructive" role="alert">
                    {errors.equipmentId}
                  </p>
                )}
              </div>

              <fieldset>
                <legend className="text-sm font-medium mb-2">For how long</legend>
                <div className="flex flex-wrap gap-2">
                  {LEND_PRESETS.map((minutes, i) => (
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
                      {formatMinutes(minutes)} <span className="sr-only">(key {i + 1})</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Due back at <span className="text-foreground tabular">{formatClock(dueAt)}</span>. Keys 1 to {LEND_PRESETS.length} pick a duration.
                </p>
              </fieldset>

              {blocked && (
                <div className="space-y-1">
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} className="mt-0.5" aria-describedby={errors.override ? "override-error" : undefined} />
                    <span>Lend anyway. The override is recorded against your name.</span>
                  </label>
                  {errors.override && (
                    <p id="override-error" className="text-sm text-destructive" role="alert">
                      {errors.override}
                    </p>
                  )}
                </div>
              )}

              <Button id="lend-submit" type="submit" className="w-full" disabled={lend.isPending}>
                {lend.isPending ? "Lending…" : chosen ? `Lend the ${chosen.name}` : "Lend equipment"}
              </Button>
            </form>
          </section>

          <div className="min-w-0 space-y-12">
            <section aria-labelledby="held-heading">
              <h2 id="held-heading" className="type-heading text-xl mb-1">
                Waiting to collect <span className="text-muted-foreground tabular">{holds.length}</span>
              </h2>
              <p className="text-sm text-muted-foreground mb-4">Students who reserved online. Check their ID, then lend it.</p>
              {equipment.isLoading ? (
                <ListSkeleton rows={2} />
              ) : holds.length === 0 ? (
                <p className="text-muted-foreground">No holds right now.</p>
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {holds.map((item) => (
                    <li key={item.id} className="flex flex-col gap-3 py-3 border-l-[3px] !border-l-line pl-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium capitalize">{item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.reservation!.name} ({item.reservation!.rollNo}), held until <span className="tabular">{formatClock(item.reservation!.until)}</span>
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" onClick={() => setLendingHold(item)}>
                          Lend
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="text-muted-foreground">
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

            <section aria-labelledby="out-heading">
              <h2 id="out-heading" className="type-heading text-xl mb-4">
                Out now <span className="text-muted-foreground tabular">{out.length}</span>
              </h2>
              {equipment.isLoading ? (
                <ListSkeleton rows={4} />
              ) : out.length === 0 ? (
                <EmptyState title="Everything is back at the desk" />
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {out.map((item) => (
                    <li key={item.id} className={cn("flex items-center justify-between gap-4 py-3", item.overdue && "border-l-4 !border-l-destructive pl-3")}>
                      <div className="min-w-0">
                        <p className="font-medium capitalize">{item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.holder?.name ? `${item.holder.name} (${item.holder.rollNo})` : item.holder?.rollNo}
                          {item.dueAt && (
                            <span className={cn("tabular", item.overdue && "text-destructive font-medium")}>, {formatDue(item.dueAt)}</span>
                          )}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => markReturned.mutate(item.id)}
                        disabled={markReturned.isPending && markReturned.variables === item.id}
                      >
                        Mark returned
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </main>

      <LendHoldDialog item={lendingHold} onClose={() => setLendingHold(null)} />

      <ScanIdDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onRollNo={handleScanned}
      />
    </div>
  );
};

export default LendPage;
