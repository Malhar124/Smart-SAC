import { useCallback, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Menu, X, Sun, Moon, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/context/AuthContext";
import { NotificationBell } from "@/components/NotificationBell";
import { CommandPalette, useCommandPaletteShortcut } from "@/components/CommandPalette";
import { cn } from "@/lib/utils";

const studentItems = [
  { label: "Dashboard", href: "/student/dashboard" },
  { label: "Rooms", href: "/student/rooms" },
  { label: "Find players", href: "/student/players" },
  { label: "Chat", href: "/student/chat" },
  { label: "Tickets", href: "/student/tickets" },
  { label: "Busy times", href: "/student/busy-times" },
  { label: "Profile", href: "/student/profile" },
];

const adminItems = [
  { label: "Dashboard", href: "/admin/dashboard" },
  { label: "Lend & return", href: "/admin/lend" },
  { label: "Equipment", href: "/admin/equipment" },
  { label: "Rooms", href: "/admin/rooms" },
  { label: "Tickets", href: "/admin/tickets" },
  { label: "History", href: "/admin/history" },
  { label: "Announcements", href: "/admin/announcements" },
];

interface NavbarProps {
  role?: "student" | "admin";
}

// Controls on the court band: light text, a faint chalk wash on hover
const bandButton =
  "inline-flex items-center justify-center gap-2 h-9 rounded-md text-sm font-medium text-court-foreground transition-colors hover:bg-white/10 focus-visible:outline-line [&_svg]:size-4";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Top of the court band. Pages continue the band with <PageHeader>, which ends in the yellow court line.
 */
const Navbar = ({ role = "student" }: NavbarProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const { logout } = useAuth();
  const isDark = resolvedTheme === "dark";
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");
  const togglePalette = useCallback((fn: (open: boolean) => boolean) => setPaletteOpen(fn), []);
  useCommandPaletteShortcut(role === "admin" ? togglePalette : noop);

  const navItems = role === "admin" ? adminItems : studentItems;
  const homePath = role === "admin" ? "/admin/dashboard" : "/student/dashboard";
  // Seven tabs plus controls need xl width before the menu collapses (class names stay literal for Tailwind)

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-court text-court-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-line focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-warning-foreground"
      >
        Skip to content
      </a>
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between h-16 gap-6">
          <Link to={homePath} className="flex items-baseline gap-2 shrink-0 focus-visible:outline-line">
            <span className="type-display text-[1.75rem] leading-none">Smart SAC</span>
            {role === "admin" && (
              <span className="rounded-sm bg-line px-1.5 py-0.5 text-xs font-semibold text-warning-foreground">Staff</span>
            )}
          </Link>

          <nav className={cn("hidden items-stretch self-stretch gap-1", "xl:flex")} aria-label="Main">
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-line focus-visible:-outline-offset-2",
                    "after:absolute after:inset-x-3 after:bottom-0 after:h-1 after:bg-line after:opacity-0",
                    isActive ? "text-court-foreground after:opacity-100" : "text-court-muted hover:text-court-foreground"
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            {role === "admin" && (
              <button type="button" className={cn(bandButton, "px-3 border border-white/25")} onClick={() => setPaletteOpen(true)}>
                <Search />
                <span className="hidden sm:inline">Search</span>
                <kbd className="hidden sm:inline rounded border border-white/25 px-1 text-[0.6875rem] font-sans text-court-muted">
                  {isMac ? "⌘K" : "Ctrl K"}
                </kbd>
              </button>
            )}
            {role === "student" && <NotificationBell />}
            <div className={cn("hidden items-center gap-1", "xl:flex")}>
              <button
                type="button"
                className={cn(bandButton, "w-9")}
                onClick={toggleTheme}
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDark ? <Sun /> : <Moon />}
              </button>
              <button type="button" className={cn(bandButton, "px-3 border border-white/25")} onClick={logout}>
                Sign out
              </button>
            </div>
            <button
              type="button"
              className={cn(bandButton, "w-9", "xl:hidden")}
              onClick={() => setIsOpen((open) => !open)}
              aria-expanded={isOpen}
              aria-controls="mobile-nav"
              aria-label={isOpen ? "Close menu" : "Open menu"}
            >
              {isOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </div>

      {isOpen && (
        <div id="mobile-nav" className={cn("border-t border-white/15 court-line", "xl:hidden")}>
          <nav className="container mx-auto px-4 pt-2 pb-5 flex flex-col" aria-label="Main">
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end
                onClick={() => setIsOpen(false)}
                className={({ isActive }) =>
                  cn("py-3 pl-3 border-l-4 text-base font-medium", isActive ? "border-line text-court-foreground" : "border-transparent text-court-muted")
                }
              >
                {item.label}
              </NavLink>
            ))}
            <div className="flex items-center gap-2 pt-4 mt-2 border-t border-white/15">
              <button type="button" className={cn(bandButton, "px-3")} onClick={toggleTheme}>
                {isDark ? <Sun /> : <Moon />}
                {isDark ? "Light mode" : "Dark mode"}
              </button>
              <button
                type="button"
                className={cn(bandButton, "px-3 ml-auto border border-white/25")}
                onClick={() => {
                  setIsOpen(false);
                  logout();
                }}
              >
                Sign out
              </button>
            </div>
          </nav>
        </div>
      )}

      {role === "admin" && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />}
    </header>
  );
};

const noop = () => {};

export default Navbar;
