import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, qs } from "@/lib/api";
import { STATUS_WORD, TICKET_STATUS_LABEL } from "@/lib/format";
import type { SearchResults } from "@/lib/types";

interface Shortcut {
  label: string;
  to: string;
  keywords?: string;
}

const PAGES: Shortcut[] = [
  { label: "Dashboard", to: "/admin/dashboard", keywords: "home overview overdue" },
  { label: "Lend & return", to: "/admin/lend", keywords: "checkout borrow give back scan" },
  { label: "Equipment", to: "/admin/equipment", keywords: "games items broken fixed add remove" },
  { label: "Rooms", to: "/admin/rooms", keywords: "bookings slots" },
  { label: "Tickets", to: "/admin/tickets", keywords: "complaints reports requests" },
  { label: "History", to: "/admin/history", keywords: "log changes" },
  { label: "Announcements", to: "/admin/announcements", keywords: "post notice" },
  { label: "Busy times", to: "/admin/busy-times", keywords: "usage analytics chart" },
];

const ACTIONS: Shortcut[] = [
  { label: "Lend equipment", to: "/admin/lend", keywords: "checkout borrow" },
  { label: "Post an announcement", to: "/admin/announcements", keywords: "notice" },
  { label: "Add equipment", to: "/admin/equipment", keywords: "new item" },
  { label: "Add a room", to: "/admin/rooms", keywords: "new" },
];

const matches = (s: Shortcut, q: string) => !q || `${s.label} ${s.keywords ?? ""}`.toLowerCase().includes(q.toLowerCase());

const useDebounced = (value: string, ms = 200) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
};

const groupClass =
  "px-2 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";
const itemClass =
  "flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-2.5 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

/**
 * Staff command palette (Ctrl+K / Cmd+K): jump to a page, start an action, or find equipment,
 * students, rooms and tickets by name.
 */
export const CommandPalette = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim());
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<SearchResults>(`/admin/search${qs({ q: debounced })}`),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  const pages = useMemo(() => PAGES.filter((p) => matches(p, query)), [query]);
  const actions = useMemo(() => ACTIONS.filter((a) => matches(a, query)), [query]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  const results = debounced.length >= 2 ? data : undefined;
  const nothing = pages.length + actions.length === 0 && !isFetching &&
    (!results || results.equipment.length + results.students.length + results.rooms.length + results.tickets.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-xl top-[20%] translate-y-0">
        <DialogTitle className="sr-only">Search Smart SAC</DialogTitle>
        <DialogDescription className="sr-only">Type to find pages, actions, equipment, students, rooms and tickets.</DialogDescription>
        <CommandPrimitive shouldFilter={false} loop className="flex flex-col bg-popover text-popover-foreground">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search items, students, rooms, tickets or pages"
              className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandPrimitive.List className="max-h-[min(26rem,60vh)] overflow-y-auto py-1">
            {nothing && <p className="px-4 py-6 text-sm text-muted-foreground">Nothing matches “{query.trim()}”.</p>}

            {results && results.students.length > 0 && (
              <CommandPrimitive.Group heading="Students" className={groupClass}>
                {results.students.map((s) => (
                  <CommandPrimitive.Item key={s.id} value={`student-${s.id}`} onSelect={() => go(`/admin/lend?roll=${encodeURIComponent(s.roll_no)}`)} className={itemClass}>
                    <span>{s.fullname}</span>
                    <span className="text-muted-foreground tabular">{s.roll_no}</span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}
            {results && results.equipment.length > 0 && (
              <CommandPrimitive.Group heading="Equipment" className={groupClass}>
                {results.equipment.map((e) => (
                  <CommandPrimitive.Item
                    key={e.id}
                    value={`equipment-${e.id}`}
                    onSelect={() => go(e.status === "available" ? `/admin/lend?equipment=${e.id}` : `/admin/equipment#item-${e.id}`)}
                    className={itemClass}
                  >
                    <span className="capitalize">{e.name}</span>
                    <span className="text-muted-foreground">{STATUS_WORD[e.status]}</span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}
            {results && results.tickets.length > 0 && (
              <CommandPrimitive.Group heading="Tickets" className={groupClass}>
                {results.tickets.map((t) => (
                  <CommandPrimitive.Item key={t.id} value={`ticket-${t.id}`} onSelect={() => go(`/admin/tickets?ticket=${t.id}`)} className={itemClass}>
                    <span className="truncate">{t.heading}</span>
                    <span className="text-muted-foreground shrink-0">{TICKET_STATUS_LABEL[t.status]}</span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}
            {results && results.rooms.length > 0 && (
              <CommandPrimitive.Group heading="Rooms" className={groupClass}>
                {results.rooms.map((r) => (
                  <CommandPrimitive.Item key={r.id} value={`room-${r.id}`} onSelect={() => go(`/admin/rooms`)} className={itemClass}>
                    {r.name}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}
            {actions.length > 0 && (
              <CommandPrimitive.Group heading="Actions" className={groupClass}>
                {actions.map((a) => (
                  <CommandPrimitive.Item key={a.label} value={`action-${a.label}`} onSelect={() => go(a.to)} className={itemClass}>
                    {a.label}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}
            {pages.length > 0 && (
              <CommandPrimitive.Group heading="Pages" className={groupClass}>
                {pages.map((p) => (
                  <CommandPrimitive.Item key={p.to} value={`page-${p.to}`} onSelect={() => go(p.to)} className={itemClass}>
                    {p.label}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            )}
          </CommandPrimitive.List>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Arrow keys to move, Enter to open, Esc to close
          </p>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
};

/** Opens the palette on Ctrl+K / Cmd+K */
export const useCommandPaletteShortcut = (setOpen: (fn: (open: boolean) => boolean) => void) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
};
