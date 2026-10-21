import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, isApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatDue } from "@/lib/format";
import type { EquipmentStatus, StaffEquipmentItem } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { EquipmentStatusLabel } from "@/components/EquipmentRegister";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface GameWithItems {
  id: string;
  name: string;
  equipments: { id: string; name: string; status: EquipmentStatus }[];
}

const Confirm = ({
  trigger,
  title,
  description,
  action,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  action: string;
  onConfirm: () => void;
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle className="first-letter:uppercase">{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep it</AlertDialogCancel>
        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm}>
          {action}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const AddItemForm = ({ gameId, gameName }: { gameId: string; gameName: string }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.post("/admin/add-equipment", { gameId, name: name.trim() }),
    onSuccess: () => {
      toast.success(`Added ${name.trim()}`);
      setName("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: qk.staffGames });
      queryClient.invalidateQueries({ queryKey: qk.staffEquipment });
    },
    onError: (e) => setError(isApiError(e) ? e.fieldErrors.name ?? e.message : "Couldn't add it."),
    meta: { silent: true },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Type the item's name");
    add.mutate();
  };
  const id = `add-item-${gameId}`;
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        New {gameName} item
      </label>
      <div className="flex gap-2 max-w-md">
        <Input
          id={id}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`New ${gameName} item, like “${gameName} 3”`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          maxLength={60}
        />
        <Button type="submit" variant="outline" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add item"}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
};

const EquipmentPage = () => {
  const queryClient = useQueryClient();
  const [newGame, setNewGame] = useState("");
  const [gameError, setGameError] = useState<string | null>(null);

  const games = useQuery({ queryKey: qk.staffGames, queryFn: () => api.get<GameWithItems[]>("/admin/get-games") });
  const equipment = useQuery({ queryKey: qk.staffEquipment, queryFn: () => api.get<StaffEquipmentItem[]>("/admin/get-equipment") });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.staffGames });
    queryClient.invalidateQueries({ queryKey: qk.staffEquipment });
    queryClient.invalidateQueries({ queryKey: qk.staffDashboard });
  };

  const addGame = useMutation({
    mutationFn: (name: string) => api.post("/admin/add-game", { name }),
    onSuccess: () => {
      toast.success("Game added");
      setNewGame("");
      setGameError(null);
    },
    onError: (e) => setGameError(isApiError(e) ? e.fieldErrors.name ?? e.message : "Couldn't add the game."),
    onSettled: refresh,
    meta: { silent: true },
  });
  const removeGame = useMutation({
    mutationFn: (gameId: string) => api.post("/admin/remove-game", { gameId }),
    onSuccess: () => toast.success("Game removed"),
    onSettled: refresh,
  });
  const setStatus = useMutation({
    mutationFn: (body: { equipmentId: string; status: "available" | "broken" }) => api.post("/admin/set-equipment-status", body),
    onSuccess: (_d, body) => toast.success(body.status === "broken" ? "Marked broken" : "Marked fixed"),
    onSettled: refresh,
  });
  const markReturned = useMutation({
    mutationFn: (equipmentId: string) => api.post<{ late: boolean }>("/admin/return-equipment", { equipmentId }),
    onSuccess: (r) => toast.success(r.late ? "Marked returned (late)" : "Marked returned"),
    onSettled: refresh,
  });
  const removeItem = useMutation({
    mutationFn: (equipmentId: string) => api.post("/admin/remove-equipment", { equipmentId }),
    onSuccess: () => toast.success("Item removed"),
    onSettled: refresh,
  });

  const details = new Map((equipment.data ?? []).map((e) => [e.id, e]));
  const gameList = games.data ?? [];
  const inAGame = new Set(gameList.flatMap((g) => g.equipments.map((e) => e.id)));
  const ungrouped = (equipment.data ?? []).filter((e) => !inAGame.has(e.id));
  const busy = (id: string) =>
    (setStatus.isPending && setStatus.variables?.equipmentId === id) ||
    (markReturned.isPending && markReturned.variables === id) ||
    (removeItem.isPending && removeItem.variables === id);

  // A render function (not a nested component) so rows aren't remounted on every render
  const renderItemRow = (id: string, name: string) => {
    const item = details.get(id);
    const status = item?.status ?? "available";
    return (
      <li key={id} id={`item-${id}`} className={cn("flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between", item?.overdue && "border-l-4 !border-l-destructive pl-3")}>
        <div className="min-w-0">
          <p className="font-medium capitalize">{name}</p>
          <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3">
            <EquipmentStatusLabel status={status} reserved={Boolean(item?.reservation)} />
            {item?.status === "in_use" && (
              <span>
                {item.holder?.name ?? item.holder?.rollNo}
                {item.dueAt && <span className={cn("tabular", item.overdue && "text-destructive")}>, {formatDue(item.dueAt)}</span>}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {status === "in_use" && (
            <Button size="sm" variant="outline" disabled={busy(id)} onClick={() => markReturned.mutate(id)}>
              Mark returned
            </Button>
          )}
          {status === "broken" ? (
            <Button size="sm" variant="outline" disabled={busy(id)} onClick={() => setStatus.mutate({ equipmentId: id, status: "available" })}>
              Mark fixed
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={busy(id)}
              onClick={() => setStatus.mutate({ equipmentId: id, status: "broken" })}
            >
              Mark broken
            </Button>
          )}
          <Confirm
            trigger={
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={status === "in_use" || busy(id)} title={status === "in_use" ? "Mark it returned first" : undefined}>
                Remove
              </Button>
            }
            title={`Remove the ${name}?`}
            description="It disappears from the rack and its history is deleted. This can't be undone."
            action="Remove item"
            onConfirm={() => removeItem.mutate(id)}
          />
        </div>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar role="admin" />
      <PageHeader title="Equipment" description="Games, the items for each, and what condition they're in." width="max-w-4xl" />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-4xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newGame.trim()) return setGameError("Type the game's name");
            addGame.mutate(newGame.trim());
          }}
          className="mb-12"
        >
          <label htmlFor="new-game" className="text-sm font-medium">
            Add a game
          </label>
          <div className="mt-2 flex gap-2 max-w-md">
            <Input
              id="new-game"
              value={newGame}
              onChange={(e) => setNewGame(e.target.value)}
              placeholder="Table tennis"
              maxLength={40}
              aria-invalid={gameError ? true : undefined}
              aria-describedby={gameError ? "new-game-error" : undefined}
            />
            <Button type="submit" disabled={addGame.isPending}>
              {addGame.isPending ? "Adding…" : "Add game"}
            </Button>
          </div>
          {gameError && (
            <p id="new-game-error" className="mt-1 text-sm text-destructive" role="alert">
              {gameError}
            </p>
          )}
        </form>

        {games.error ? (
          <ErrorState title="Couldn't load equipment" error={games.error} onRetry={() => games.refetch()} />
        ) : games.isLoading ? (
          <ListSkeleton rows={6} />
        ) : gameList.length === 0 && ungrouped.length === 0 ? (
          <EmptyState title="No games yet">Add a game above, then add its items. Students see them on their dashboard straight away.</EmptyState>
        ) : (
          <div className="space-y-12">
            {gameList.map((game) => {
              const out = game.equipments.filter((e) => e.status === "in_use");
              return (
                <section key={game.id} id={`game-${game.id}`} aria-labelledby={`game-${game.id}-heading`}>
                  <div className="flex items-baseline justify-between gap-4 mb-2">
                    <h2 id={`game-${game.id}-heading`} className="type-heading text-xl capitalize">
                      {game.name} <span className="text-muted-foreground tabular text-base">{game.equipments.length}</span>
                    </h2>
                    <Confirm
                      trigger={
                        <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground hover:text-destructive" disabled={out.length > 0} title={out.length > 0 ? "Take back the items that are out first" : undefined}>
                          Remove game
                        </Button>
                      }
                      title={`Remove ${game.name}?`}
                      description={`Its ${game.equipments.length} ${game.equipments.length === 1 ? "item is" : "items are"} deleted too, and students who listed it lose it from their profile. This can't be undone.`}
                      action="Remove game"
                      onConfirm={() => removeGame.mutate(game.id)}
                    />
                  </div>
                  {game.equipments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No items yet.</p>
                  ) : (
                    <ul className="divide-y divide-border border-y border-border">
                      {game.equipments.map((e) => renderItemRow(e.id, e.name))}
                    </ul>
                  )}
                  <AddItemForm gameId={game.id} gameName={game.name} />
                </section>
              );
            })}

            {ungrouped.length > 0 && (
              <section aria-labelledby="other-heading">
                <h2 id="other-heading" className="type-heading text-xl mb-2">
                  Not in a game
                </h2>
                <ul className="divide-y divide-border border-y border-border">
                  {ungrouped.map((e) => renderItemRow(e.id, e.name))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default EquipmentPage;
