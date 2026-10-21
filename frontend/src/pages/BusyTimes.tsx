import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api, qs } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatHour, formatMinutes } from "@/lib/format";
import type { Usage } from "@/lib/types";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { EmptyState, ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const RANGES = [7, 14, 28, 56] as const;

const chip = (active: boolean) =>
  cn(
    "h-8 px-3 rounded-md border text-sm font-medium transition-colors",
    active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
  );

/** When the desk is busy, from real checkouts. Students and staff see the same chart. */
const BusyTimes = ({ role }: { role: "student" | "admin" }) => {
  const [days, setDays] = useState<(typeof RANGES)[number]>(28);
  const [gameId, setGameId] = useState<string | null>(null);

  const usage = useQuery({
    queryKey: [...qk.usage, role, days, gameId],
    queryFn: () => api.get<Usage>(`/${role === "admin" ? "admin" : "users"}/get-usage${qs({ days, gameId })}`),
    placeholderData: (previous) => previous,
  });

  const data = usage.data;
  const gameName = data?.games.find((g) => g.id === gameId)?.name;

  return (
    <div className="min-h-screen bg-background">
      <Navbar role={role} />
      <PageHeader
        title="Busy times"
        description="How many items are out at each hour of a typical day, from real checkouts at the desk. Pick a quiet hour to find one free."
        width="max-w-4xl"
      />

      <main id="main" tabIndex={-1} className="container mx-auto max-w-4xl px-4 md:px-6 pt-10 pb-16 focus:outline-none">
        <div className="flex flex-col gap-3 mb-8">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Game">
            <button type="button" aria-pressed={gameId === null} onClick={() => setGameId(null)} className={chip(gameId === null)}>
              All games
            </button>
            {(data?.games ?? []).map((g) => (
              <button key={g.id} type="button" aria-pressed={gameId === g.id} onClick={() => setGameId(g.id)} className={cn(chip(gameId === g.id), "capitalize")}>
                {g.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
            <span className="text-sm text-muted-foreground mr-1">Last</span>
            {RANGES.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={cn(chip(days === d), "tabular")}>
                {d === 7 ? "week" : d === 28 ? "4 weeks" : d === 56 ? "8 weeks" : "2 weeks"}
              </button>
            ))}
          </div>
        </div>

        {usage.error ? (
          <ErrorState title="Couldn't load busy times" error={usage.error} onRetry={() => usage.refetch()} />
        ) : !data ? (
          <Skeleton className="h-80 w-full" />
        ) : !data.enoughData ? (
          <EmptyState title="Not enough checkouts yet">
            {data.totalLoans === 0
              ? "Nothing has been lent"
              : `Only ${data.totalLoans} ${data.totalLoans === 1 ? "checkout" : "checkouts"} so far`}
            {gameName ? ` for ${gameName}` : ""} in this period. The chart appears after {data.minLoans}, so it reflects a real pattern
            instead of a few visits. Try a longer period or all games.
          </EmptyState>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-4 mb-8 border-y border-border py-4">
              <div>
                <dt className="text-sm text-muted-foreground">Busiest</dt>
                <dd className="type-heading text-2xl tabular">{formatHour(data.busiestHour!)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Quietest</dt>
                <dd className="type-heading text-2xl tabular">{formatHour(data.quietestHour!)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Typical checkout</dt>
                <dd className="type-heading text-2xl tabular">{data.typicalLoanMinutes ? formatMinutes(data.typicalLoanMinutes) : "None yet"}</dd>
              </div>
            </dl>

            <figure>
              <figcaption className="type-heading text-lg mb-4">
                <span className="capitalize">{gameName ?? "All"}</span> items out on an average day, by hour
              </figcaption>
              <div className={cn("h-72 sm:h-80 -ml-4 transition-opacity", usage.isFetching && "opacity-60")}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.hours} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={formatHour}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tickLine={false} axisLine={false} width={40} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <Tooltip
                      separator=""
                      cursor={{ fill: "hsl(var(--muted))" }}
                      labelFormatter={(hour: number) => `${formatHour(hour)} to ${formatHour(hour + 1)}`}
                      formatter={(value: number) => [`${value} out on average`, ""]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                        color: "hsl(var(--popover-foreground))",
                      }}
                    />
                    <Bar dataKey="averageOut" radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false}>
                      {data.hours.map((row) => (
                        <Cell key={row.hour} fill={row.hour === data.busiestHour ? "hsl(var(--line))" : "hsl(var(--primary))"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </figure>

            {/* The same numbers as text, for screen readers and anyone who prefers a table */}
            <details className="mt-6 text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as a table</summary>
              <table className="mt-3 w-full max-w-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="font-medium py-1">Hour</th>
                    <th scope="col" className="font-medium py-1 text-right">Items out on average</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hours.map((row) => (
                    <tr key={row.hour} className="border-t border-border">
                      <td className="py-1 tabular">{formatHour(row.hour)}</td>
                      <td className="py-1 text-right tabular">{row.averageOut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            <p className="mt-6 text-sm text-muted-foreground">
              From {data.totalLoans} checkouts in the last {days} days. Times are SAC time.
            </p>
          </>
        )}
      </main>
    </div>
  );
};

export default BusyTimes;
