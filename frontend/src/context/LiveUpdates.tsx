import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/config";
import { refreshSession } from "@/lib/api";
import { invalidationsFor } from "@/lib/queryKeys";
import { useAuth } from "@/context/AuthContext";

type LiveStatus = "off" | "connecting" | "live";

const LiveContext = createContext<LiveStatus>("off");

/**
 * Keeps one Server-Sent Events connection open while someone is signed in. Each event names what
 * changed; the matching queries are marked stale and refetch, so racks, desks, chats and badges
 * update without polling.
 */
export const LiveUpdatesProvider = ({ children }: { children: ReactNode }) => {
  const { authType } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("off");

  useEffect(() => {
    if (!authType || typeof EventSource === "undefined") {
      setStatus("off");
      return;
    }

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      source = new EventSource(`${API_BASE_URL}/events`, { withCredentials: true });

      source.onopen = () => {
        attempts = 0;
        setStatus("live");
        // Anything could have changed while disconnected
        queryClient.invalidateQueries();
      };

      source.onmessage = (event) => {
        try {
          const { type } = JSON.parse(event.data) as { type: string };
          for (const key of invalidationsFor[type] ?? []) queryClient.invalidateQueries({ queryKey: key });
        } catch {
          // Ignore malformed messages; the next real change will refresh things
        }
      };

      source.onerror = async () => {
        // EventSource retries network drops itself; a closed stream usually means the access
        // token expired (the stream is authenticated once, at connect). Refresh, then reconnect.
        if (source?.readyState !== EventSource.CLOSED) {
          setStatus("connecting");
          return;
        }
        source.close();
        attempts += 1;
        await refreshSession(authType);
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5));
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
      setStatus("off");
    };
  }, [authType, queryClient]);

  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>;
};

export const useLiveStatus = () => useContext(LiveContext);
