import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import type { Player } from "@/lib/types";
import { cn } from "@/lib/utils";

type ApiPlayer = Player;

const FindPlayers = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGame, setSelectedGame] = useState<string | null>(null);

  const { data: players = [], isLoading, error, refetch } = useQuery({
    queryKey: qk.players,
    queryFn: () => api.get<Player[]>("/users/get-all-players"),
  });

  const sendMessageMutation = useMutation({
    mutationFn: (variables: { receiverId: string; content: string }) => api.post("/users/send-message", variables),
    onSuccess: () => {
      toast.success("Request sent", { description: "It's in your chat with them." });
    },
  });

  const askToPlay = (player: ApiPlayer) => {
    // Ask about the game being filtered on, otherwise their first game
    const game = selectedGame ?? player.games[0]?.game.name;
    sendMessageMutation.mutate({
      receiverId: player.id,
      content: game ? `Hey! Would you like to play ${game} sometime?` : "Hey! Would you like to play sometime?",
    });
  };

  const allGames = Array.from(new Set(players.flatMap((p) => p.games?.map((g) => g.game.name) ?? []))).sort();

  const search = searchQuery.trim().toLowerCase();
  const filteredPlayers = players.filter((player) => {
    const matchesGame = !selectedGame || player.games?.some((g) => g.game.name === selectedGame);
    const matchesSearch = !search || player.fullname.toLowerCase().includes(search);
    return matchesGame && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <PageHeader
        title="Find players"
        description="Students who've added their games. Ratings are out of 5 and set by each player."
        width="max-w-4xl"
      />

      <main id="main" tabIndex={-1} className="focus:outline-none container mx-auto max-w-4xl px-4 md:px-6 pt-10 pb-16">

        <div className="space-y-4 mb-6">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              placeholder="Search by name"
              aria-label="Search players by name"
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {allGames.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by game">
              {[null, ...allGames].map((game) => (
                <button
                  key={game ?? "all"}
                  type="button"
                  aria-pressed={selectedGame === game}
                  onClick={() => setSelectedGame(game)}
                  className={cn(
                    "h-8 px-3 rounded-md border text-sm font-medium transition-colors",
                    game && "capitalize",
                    selectedGame === game
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  {game ?? "All games"}
                </button>
              ))}
            </div>
          )}
        </div>

        {error ? (
          <div className="border border-border rounded-lg bg-card p-6">
            <h2 className="type-heading text-lg">Couldn't load players</h2>
            <p className="mt-1 text-muted-foreground">Check that you're online, then try again.</p>
            <Button className="mt-4" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-3" aria-label="Loading players">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filteredPlayers.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-6 text-center">
            {players.length === 0 ? (
              <p className="text-muted-foreground">
                No other players yet. Add your games on your{" "}
                <Link to="/student/profile" className="text-primary underline-offset-4 hover:underline">
                  profile
                </Link>{" "}
                so people can find you.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">No players match that search.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedGame(null);
                  }}
                >
                  Clear filters
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-2 tabular">
              {filteredPlayers.length} {filteredPlayers.length === 1 ? "player" : "players"}
            </p>
            <ul className="divide-y divide-border border-y border-border">
              {filteredPlayers.map((player) => {
                const sending =
                  sendMessageMutation.isPending && sendMessageMutation.variables?.receiverId === player.id;
                return (
                  <li key={player.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{player.fullname}</p>
                      {player.games.length > 0 ? (
                        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {player.games.map((g) => (
                            <li
                              key={g.game.id}
                              className={cn(
                                "capitalize",
                                selectedGame && g.game.name !== selectedGame ? "text-muted-foreground" : "text-foreground"
                              )}
                            >
                              {g.game.name}{" "}
                              <span className="text-muted-foreground tabular">{g.rating.toFixed(1)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">No games added yet</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-fit shrink-0"
                      disabled={sending}
                      onClick={() => askToPlay(player)}
                    >
                      {sending ? "Sending…" : "Ask to play"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
};

export default FindPlayers;
