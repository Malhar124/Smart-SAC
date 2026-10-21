import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { timeAgo } from "@/lib/format";
import type { AppNotification } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NotificationsResponse {
  notifications: AppNotification[];
  unread: number;
}

/** The student's notifications: reminders, ticket replies, room changes and announcements */
export const NotificationBell = ({ className }: { className?: string }) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<NotificationsResponse>("/users/get-notifications?limit=30"),
  });

  // Optimistic: the badge and dots clear immediately; the server catches up
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post("/users/mark-notifications-read", ids ? { ids } : {}),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: qk.notifications });
      const previous = queryClient.getQueryData<NotificationsResponse>(qk.notifications);
      if (previous) {
        const now = new Date().toISOString();
        const notifications = previous.notifications.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n));
        queryClient.setQueryData<NotificationsResponse>(qk.notifications, {
          notifications,
          unread: notifications.filter((n) => !n.readAt).length,
        });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(qk.notifications, context.previous);
    },
    meta: { silent: true },
  });

  const unread = data?.unread ?? 0;
  const notifications = data?.notifications ?? [];

  const openNotification = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate([n.id]);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex items-center justify-center h-9 w-9 rounded-md text-court-foreground transition-colors hover:bg-white/10 focus-visible:outline-line [&_svg]:size-4",
            className
          )}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-line text-warning-foreground text-[0.6875rem] font-bold tabular grid place-items-center" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
          <p className="type-heading text-base">Notifications</p>
          {unread > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => markRead.mutate(undefined)}>
              Mark all read
            </Button>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Nothing yet. Reminders about holds, due times, your tickets and room bookings show up here.
          </p>
        ) : (
          <ul className="max-h-[min(28rem,70vh)] overflow-y-auto divide-y divide-border">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  className={cn(
                    "w-full text-left px-4 py-3 border-l-[3px] transition-colors hover:bg-accent focus-visible:outline-offset-[-2px]",
                    n.readAt ? "border-transparent" : "border-line"
                  )}
                >
                  <span className={cn("block text-sm leading-snug", !n.readAt && "font-semibold")}>{n.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground line-clamp-2">{n.body}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {timeAgo(n.createdAt)}
                    {!n.readAt && <span className="sr-only">, unread</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
};
