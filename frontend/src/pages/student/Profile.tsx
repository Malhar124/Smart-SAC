import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatClock, formatDayClock, formatDue } from "@/lib/format";
import { changePasswordSchema, profileSchema, serverFieldErrors, validate, type FieldErrors } from "@/lib/schemas";
import type { CurrentStudent, Game } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { Field, fieldProps } from "@/components/Field";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface GameRating {
  game: Game;
  rating: number;
}

interface FormState {
  fullname: string;
  phone_number: string;
  roll_no: string;
  games: GameRating[];
  achievements: string[];
}

const fromProfile = (data: CurrentStudent): FormState => ({
  fullname: data.userDetails.fullname,
  phone_number: data.userDetails.phone_number,
  roll_no: data.userDetails.roll_no,
  games: data.userDetails.games.map((g) => ({ game: g.game, rating: g.rating })),
  achievements: data.userDetails.achievements,
});

const SectionTitle = ({ id, children }: { id: string; children: string }) => (
  <h2 id={id} className="type-heading text-xl mb-3">
    {children}
  </h2>
);

const ChangePassword = () => {
  const empty = { oldPassword: "", newPassword: "", confirmPassword: "" };
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const change = useMutation({
    mutationFn: (body: { oldPassword: string; newPassword: string }) => api.post("/users/change-password", body),
    onSuccess: () => {
      toast.success("Password changed");
      setValues(empty);
    },
    onError: (error) => setErrors(serverFieldErrors(error)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(changePasswordSchema, values);
    setErrors(result.errors ?? {});
    if (result.data) change.mutate({ oldPassword: result.data.oldPassword, newPassword: result.data.newPassword });
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md" noValidate>
      <Field id="oldPassword" label="Current password" error={errors.oldPassword}>
        <Input
          type="password"
          autoComplete="current-password"
          {...fieldProps("oldPassword", errors.oldPassword)}
          value={values.oldPassword}
          onChange={(e) => setValues({ ...values, oldPassword: e.target.value })}
        />
      </Field>
      <Field id="newPassword" label="New password" error={errors.newPassword} hint="8 or more characters with upper and lower case, a number and one of @ $ ! % * ? &">
        <Input
          type="password"
          autoComplete="new-password"
          {...fieldProps("newPassword", errors.newPassword, true)}
          value={values.newPassword}
          onChange={(e) => setValues({ ...values, newPassword: e.target.value })}
        />
      </Field>
      <Field id="confirmPassword" label="New password again" error={errors.confirmPassword}>
        <Input
          type="password"
          autoComplete="new-password"
          {...fieldProps("confirmPassword", errors.confirmPassword)}
          value={values.confirmPassword}
          onChange={(e) => setValues({ ...values, confirmPassword: e.target.value })}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={change.isPending}>
        {change.isPending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
};

const StudentProfile = () => {
  const queryClient = useQueryClient();
  const { reload } = useAuth();
  const me = useQuery({ queryKey: qk.me, queryFn: () => api.get<CurrentStudent>("/users/current-user") });
  const games = useQuery({ queryKey: qk.games, queryFn: () => api.get<Game[]>("/users/get-games") });

  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [selectedGame, setSelectedGame] = useState("");
  const [gameRating, setGameRating] = useState(3);
  const [newAchievement, setNewAchievement] = useState("");

  useEffect(() => {
    if (me.data && !editMode) setForm(fromProfile(me.data));
  }, [me.data, editMode]);

  const save = useMutation({
    mutationFn: (body: object) => api.post("/users/update-account-details", body),
    onSuccess: async () => {
      toast.success("Profile saved");
      setEditMode(false);
      await queryClient.invalidateQueries({ queryKey: qk.me });
      queryClient.invalidateQueries({ queryKey: qk.players });
      reload();
    },
    onError: (error) => setErrors(serverFieldErrors(error)),
  });

  if (!me.data || !form) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <PageHeader title="Profile" width="max-w-3xl" />
        <main id="main" className="container mx-auto max-w-3xl px-4 md:px-6 pt-10 pb-16">
          {me.error ? <ErrorState title="Couldn't load your profile" error={me.error} onRetry={() => me.refetch()} /> : <ListSkeleton rows={5} />}
        </main>
      </div>
    );
  }

  const data = me.data;
  const profile = data.userDetails;
  const standing = data.standing;

  const addGame = () => {
    const details = games.data?.find((g) => g.id === selectedGame);
    if (!details) {
      toast.error("Choose a game first.");
      return;
    }
    const others = form.games.filter((g) => g.game.id !== selectedGame);
    setForm({ ...form, games: [...others, { game: details, rating: gameRating }] });
    setSelectedGame("");
  };

  const submit = () => {
    const result = validate(profileSchema, form);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    save.mutate({ ...result.data, achievements: form.achievements, games: form.games.map((g) => ({ game: g.game.id, rating: g.rating })) });
  };

  const fields = [
    { key: "fullname", label: "Full name", type: "text" },
    { key: "roll_no", label: "Roll number", type: "text" },
    { key: "phone_number", label: "Phone", type: "tel" },
  ] as const;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHeader
        title={profile.fullname}
        description={`@${profile.username}`}
        width="max-w-3xl"
        actions={
          !editMode && (
            <Button variant="band" onClick={() => setEditMode(true)}>
              Edit profile
            </Button>
          )
        }
      />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-3xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <div className="space-y-12">
          <section aria-labelledby="borrowing-heading">
            <SectionTitle id="borrowing-heading">Borrowing</SectionTitle>
            {standing.blocked && (
              <div className="mb-4 border-l-4 border-destructive bg-destructive/10 rounded-r-md px-4 py-3" role="status">
                <p className="font-medium">You can't reserve or borrow right now</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{standing.message}</p>
              </div>
            )}
            {data.loans.length === 0 && !data.reservation ? (
              <p className="text-muted-foreground">Nothing checked out to you right now.</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {data.reservation && (
                  <li className="flex items-baseline justify-between gap-4 py-3">
                    <span className="font-medium capitalize">{data.reservation.name}</span>
                    <span className="text-sm text-muted-foreground tabular">Held for you until {formatClock(data.reservation.reservedUntil)}</span>
                  </li>
                )}
                {data.loans.map((loan) => (
                  <li key={loan.id} className="flex items-baseline justify-between gap-4 py-3">
                    <span className="font-medium capitalize">{loan.equipment.name}</span>
                    <span className={cn("text-sm tabular", loan.overdue ? "text-destructive font-medium" : "text-muted-foreground")}>{formatDue(loan.dueAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm text-muted-foreground">
              {standing.lateReturns === 0
                ? `No late returns in the last ${standing.windowDays} days.`
                : `${standing.lateReturns} late ${standing.lateReturns === 1 ? "return" : "returns"} in the last ${standing.windowDays} days.`}{" "}
              {standing.limit} late returns pause borrowing for a week. Returns within {standing.graceMinutes} minutes of the due time don't count.
            </p>
          </section>

          <section aria-labelledby="rooms-heading">
            <SectionTitle id="rooms-heading">Room bookings</SectionTitle>
            {data.roomBookings.length === 0 ? (
              <p className="text-muted-foreground">
                No upcoming bookings.{" "}
                <Link to="/student/rooms" className="text-primary underline-offset-4 hover:underline">
                  Book a room
                </Link>
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {data.roomBookings.map((b) => (
                  <li key={b.id} className="flex items-baseline justify-between gap-4 py-3">
                    <span className="font-medium">{b.room.name}</span>
                    <span className="text-sm text-muted-foreground tabular">
                      {formatDayClock(b.startsAt)} to {formatClock(b.endsAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="details-heading">
            <SectionTitle id="details-heading">Details</SectionTitle>
            {editMode ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map((f) => (
                  <Field key={f.key} id={`profile-${f.key}`} label={f.label} error={errors[f.key]}>
                    <Input
                      {...fieldProps(`profile-${f.key}`, errors[f.key])}
                      type={f.type}
                      value={form[f.key]}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
            ) : (
              <dl className="divide-y divide-border border-y border-border">
                {[
                  ["Email", profile.email],
                  ["Roll number", profile.roll_no],
                  ["Phone", profile.phone_number],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 py-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words tabular">{value || "Not added"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section aria-labelledby="games-heading">
            <h2 id="games-heading" className="type-heading text-xl">
              Games
            </h2>
            <p className="mt-1 mb-3 text-sm text-muted-foreground">Other students see these on Find players. Rate yourself from 0 to 5.</p>

            {editMode && (
              <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-end">
                <div className="space-y-2 sm:flex-1">
                  <Label htmlFor="add-game">Game</Label>
                  <Select value={selectedGame} onValueChange={setSelectedGame}>
                    <SelectTrigger id="add-game" className="[&>span]:first-letter:uppercase">
                      <SelectValue placeholder="Choose a game" />
                    </SelectTrigger>
                    <SelectContent>
                      {(games.data ?? []).map((game) => (
                        <SelectItem key={game.id} value={game.id} className="capitalize">
                          {game.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <fieldset>
                  <legend className="text-sm font-medium leading-none mb-2">Rating</legend>
                  <div className="inline-flex rounded-md border border-border p-0.5 bg-background">
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={gameRating === n}
                        onClick={() => setGameRating(n)}
                        className={cn(
                          "h-8 w-8 rounded-[calc(var(--radius)-2px)] text-sm font-medium tabular transition-colors",
                          gameRating === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <Button type="button" onClick={addGame}>
                  {form.games.some((g) => g.game.id === selectedGame) ? "Update rating" : "Add game"}
                </Button>
              </div>
            )}

            {form.games.length > 0 ? (
              <ul className="divide-y divide-border border-y border-border">
                {form.games.map((g) => (
                  <li key={g.game.id} className="flex items-center justify-between gap-4 py-3">
                    <span className="font-medium capitalize">{g.game.name}</span>
                    <span className="flex items-center gap-4">
                      <span className="flex items-center gap-2" aria-label={`Rated ${g.rating} out of 5`}>
                        <span className="flex gap-0.5" aria-hidden>
                          {[0, 1, 2, 3, 4].map((i) => (
                            <span key={i} className={cn("h-2 w-4 rounded-sm", i < g.rating ? "bg-primary" : "bg-muted")} />
                          ))}
                        </span>
                        <span className="text-sm text-muted-foreground tabular w-4 text-right" aria-hidden>
                          {g.rating}
                        </span>
                      </span>
                      {editMode && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setForm({ ...form, games: form.games.filter((x) => x.game.id !== g.game.id) })}
                          aria-label={`Remove ${g.game.name}`}
                        >
                          <X />
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{editMode ? "Choose a game above to add it." : "No games yet. Edit your profile to add the ones you play."}</p>
            )}
          </section>

          <section aria-labelledby="achievements-heading">
            <SectionTitle id="achievements-heading">Achievements</SectionTitle>
            {editMode && (
              <form
                className="mb-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = newAchievement.trim();
                  if (!text) return;
                  setForm({ ...form, achievements: [...form.achievements, text] });
                  setNewAchievement("");
                }}
              >
                <Input
                  placeholder="Inter-IIIT table tennis, runner-up 2025"
                  aria-label="New achievement"
                  value={newAchievement}
                  maxLength={140}
                  onChange={(e) => setNewAchievement(e.target.value)}
                />
                <Button type="submit" variant="outline">
                  Add
                </Button>
              </form>
            )}
            {form.achievements.length > 0 ? (
              <ul className="divide-y divide-border border-y border-border">
                {form.achievements.map((a, index) => (
                  <li key={`${a}-${index}`} className="flex items-center justify-between gap-4 py-3">
                    <span>{a}</span>
                    {editMode && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setForm({ ...form, achievements: form.achievements.filter((_, i) => i !== index) })}
                        aria-label={`Remove ${a}`}
                      >
                        <X />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{editMode ? "Add tournaments or wins above." : "None added yet."}</p>
            )}
          </section>

          {!editMode && (
            <section aria-labelledby="password-heading">
              <SectionTitle id="password-heading">Password</SectionTitle>
              <ChangePassword />
            </section>
          )}
        </div>

        {editMode && (
          <div className="sticky bottom-0 mt-10 -mx-4 px-4 md:-mx-6 md:px-6 py-4 border-t border-border bg-background flex gap-2">
            <Button onClick={submit} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditMode(false);
                setErrors({});
                setForm(fromProfile(data));
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </main>
    </div>
  );
};

export default StudentProfile;
