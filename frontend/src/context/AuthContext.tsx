import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, isApiError, onSessionExpired, refreshSession, setAccountKind, type AccountKind } from "@/lib/api";
import type { CurrentStudent, StaffMember, StudentProfile } from "@/lib/types";

interface AuthContextValue {
  /** The signed-in student (null for staff or signed out) */
  user: StudentProfile | null;
  /** The signed-in staff member (null for students or signed out) */
  admin: StaffMember | null;
  authType: AccountKind | null;
  isLoading: boolean;
  /** Sign in; throws ApiError (with field errors or a code) so the form can show it */
  login: (kind: AccountKind, credentials: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** Forget the account here when the server already ended the session, e.g. after deleting the account */
  signedOut: () => void;
  /** Re-read the signed-in account, e.g. after editing the profile */
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Remembers which kind of account signed in last, so a reload checks that one first
const KIND_HINT_KEY = "smart-sac.account-kind";
const readHint = (): AccountKind | null => {
  try {
    const value = localStorage.getItem(KIND_HINT_KEY);
    return value === "student" || value === "admin" ? value : null;
  } catch {
    return null;
  }
};
const writeHint = (kind: AccountKind | null) => {
  try {
    if (kind) localStorage.setItem(KIND_HINT_KEY, kind);
    else localStorage.removeItem(KIND_HINT_KEY);
  } catch {
    // Private mode or blocked storage: the check just takes one extra request
  }
};

const fetchAccount = async (kind: AccountKind) => {
  if (kind === "student") {
    const data = await api.get<CurrentStudent>("/users/current-user");
    return { user: data.userDetails, admin: null };
  }
  return { user: null, admin: await api.get<StaffMember>("/admin/current-admin") };
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<StudentProfile | null>(null);
  const [admin, setAdmin] = useState<StaffMember | null>(null);
  const [authType, setAuthType] = useState<AccountKind | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const locationRef = useRef(location);
  locationRef.current = location;

  const clear = useCallback(() => {
    setUser(null);
    setAdmin(null);
    setAuthType(null);
    setAccountKind(null);
    writeHint(null);
    queryClient.clear();
  }, [queryClient]);

  /**
   * Try one kind of account: the current session, then one refresh. True when signed in as that kind.
   * The API client's automatic refresh stays off (account kind unset) until this succeeds, so a
   * visitor who simply isn't signed in never sees a "session expired" message.
   */
  const tryKind = useCallback(async (kind: AccountKind) => {
    const adopt = (account: Awaited<ReturnType<typeof fetchAccount>>) => {
      setAccountKind(kind);
      setUser(account.user);
      setAdmin(account.admin);
      setAuthType(kind);
      writeHint(kind);
      return true;
    };
    try {
      return adopt(await fetchAccount(kind));
    } catch (error) {
      if (isApiError(error) && error.status === 401 && (await refreshSession(kind))) {
        try {
          return adopt(await fetchAccount(kind));
        } catch {
          // fall through to "not signed in"
        }
      }
      return false;
    }
  }, []);

  // On load: check the remembered kind first, then the other
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const first = readHint() ?? "student";
      const second: AccountKind = first === "student" ? "admin" : "student";
      if (!(await tryKind(first)) && !cancelled) await tryKind(second);
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tryKind]);

  // A refresh that fails mid-session signs the person out and sends them to sign in again
  useEffect(() => {
    onSessionExpired(() => {
      const kind = authType;
      clear();
      toast.error("Your session expired. Sign in again.");
      const back = encodeURIComponent(locationRef.current.pathname + locationRef.current.search);
      navigate(kind === "admin" ? `/admin/login?next=${back}` : `/student-login?next=${back}`, { replace: true });
    });
    return () => onSessionExpired(null);
  }, [authType, clear, navigate]);

  const login = useCallback(
    async (kind: AccountKind, credentials: { email: string; password: string }) => {
      await api.post(kind === "student" ? "/users/login" : "/admin/login", credentials);
      if (!(await tryKind(kind))) throw new Error("Signed in, but couldn't load your account. Refresh the page.");
      const next = new URLSearchParams(locationRef.current.search).get("next");
      const home = kind === "student" ? "/student/dashboard" : "/admin/dashboard";
      // Only follow same-app paths for the right kind of account
      const safeNext = next && next.startsWith(kind === "student" ? "/student" : "/admin") ? next : null;
      navigate(safeNext ?? home, { replace: true });
    },
    [navigate, tryKind]
  );

  const signedOut = useCallback(() => {
    clear();
    navigate("/", { replace: true });
  }, [clear, navigate]);

  const logout = useCallback(async () => {
    if (authType) {
      try {
        await api.post(authType === "student" ? "/users/logout" : "/admin/logout");
      } catch {
        // Signing out locally is what matters; the server session expires on its own
      }
    }
    signedOut();
  }, [authType, signedOut]);

  const reload = useCallback(async () => {
    if (authType) await tryKind(authType);
  }, [authType, tryKind]);

  const value = useMemo(
    () => ({ user, admin, authType, isLoading, login, logout, signedOut, reload }),
    [user, admin, authType, isLoading, login, logout, signedOut, reload]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};
