import { useState, type FormEvent } from "react";
import { formatDayClock, TICKET_STATUS_LABEL } from "@/lib/format";
import type { Ticket, TicketEvent, TicketStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const statusDot: Record<TicketStatus, string> = {
  open: "bg-destructive",
  in_process: "bg-line",
  closed: "bg-muted-foreground",
};

export const TicketStatusLabel = ({ status }: { status: TicketStatus }) => (
  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
    <span className={cn("h-2 w-2 rounded-full", statusDot[status])} aria-hidden />
    {TICKET_STATUS_LABEL[status]}
  </span>
);

const describe = (event: TicketEvent, viewer: "student" | "staff") => {
  const who = event.author ? (event.author.kind === "student" && viewer === "student" ? "You" : event.author.name) : "Someone";
  if (event.type === "created") return `${who} opened this ticket`;
  if (event.type === "status_changed") return `${who} marked it ${TICKET_STATUS_LABEL[event.toStatus ?? "open"].toLowerCase()}`;
  return who;
};

/** The ticket's history, oldest first: opened, status changes and replies */
export const TicketTimeline = ({ ticket, viewer }: { ticket: Ticket; viewer: "student" | "staff" }) => (
  <ol className="relative space-y-5 border-l-2 border-border pl-5" aria-label="Ticket history">
    {(ticket.events ?? []).map((event) => (
      <li key={event.id} className="relative">
        <span
          className={cn(
            "absolute -left-[1.6875rem] top-1 h-3 w-3 rounded-full border-2 border-background",
            event.type === "comment" ? (event.author?.kind === "staff" ? "bg-primary" : "bg-muted-foreground") : statusDot[event.toStatus ?? "open"]
          )}
          aria-hidden
        />
        <p className="text-sm">
          <span className="font-medium">{describe(event, viewer)}</span>
          {event.author?.kind === "staff" && event.type === "comment" && <span className="text-muted-foreground"> (SAC desk)</span>}
          <span className="text-muted-foreground">, {formatDayClock(event.createdAt)}</span>
        </p>
        {event.body && (
          <p
            className={cn(
              "mt-1.5 text-sm whitespace-pre-wrap rounded-md px-3 py-2 max-w-[65ch]",
              event.author?.kind === "staff" ? "bg-primary/10" : "bg-muted"
            )}
          >
            {event.body}
          </p>
        )}
        {event.type === "created" && <p className="mt-1.5 text-sm whitespace-pre-wrap max-w-[65ch]">{ticket.content}</p>}
      </li>
    ))}
  </ol>
);

/** A reply box under the timeline. Hidden once the ticket is closed. */
export const TicketReplyForm = ({
  onSubmit,
  pending,
  placeholder,
}: {
  onSubmit: (body: string) => Promise<unknown> | void;
  pending: boolean;
  placeholder: string;
}) => {
  const [body, setBody] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await onSubmit(body.trim());
      setBody("");
    } catch {
      // The error toast explains it; keep the text so nothing is lost
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="ticket-reply" className="text-sm font-medium">
        Reply
      </label>
      <Textarea id="ticket-reply" value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder={placeholder} maxLength={2000} />
      <Button type="submit" size="sm" disabled={pending || !body.trim()}>
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
};
