import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { LiveUpdatesProvider } from "@/context/LiveUpdates";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageSkeleton } from "@/components/states";
import { isApiError } from "@/lib/api";
import { reportError } from "@/lib/monitoring";

// Each page is its own chunk, loaded when first visited
const Login = lazy(() => import("@/pages/Login"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const AllAnnouncements = lazy(() => import("@/pages/AllAnnouncements"));
const StudentLogin = lazy(() => import("@/pages/student/StudentLogin"));
const StudentRegister = lazy(() => import("@/pages/student/StudentRegister"));
const EmailVerification = lazy(() => import("@/pages/student/EmailVerification"));
const ForgotPassword = lazy(() => import("@/pages/student/ForgotPassword"));
const AdminLogin = lazy(() => import("@/pages/admin/AdminLogin"));
const RegisterAdmin = lazy(() => import("@/pages/admin/RegisterAdmin"));

const StudentDashboard = lazy(() => import("@/pages/student/Dashboard"));
const StudentRooms = lazy(() => import("@/pages/student/Rooms"));
const FindPlayers = lazy(() => import("@/pages/student/Players"));
const Chat = lazy(() => import("@/pages/student/Chat"));
const StudentTickets = lazy(() => import("@/pages/student/Tickets"));
const BusyTimes = lazy(() => import("@/pages/BusyTimes"));
const StudentProfile = lazy(() => import("@/pages/student/Profile"));

const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const AdminLend = lazy(() => import("@/pages/admin/Lend"));
const AdminEquipment = lazy(() => import("@/pages/admin/Equipment"));
const AdminRooms = lazy(() => import("@/pages/admin/Rooms"));
const AdminTickets = lazy(() => import("@/pages/admin/AdminTickets"));
const AdminHistory = lazy(() => import("@/pages/admin/EquipmentHistoryPage"));
const AdminAnnouncements = lazy(() => import("@/pages/admin/AdminAnnouncements"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't hammer the server on auth or validation failures
      retry: (count, error) => !(isApiError(error) && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (!isApiError(error)) reportError(error);
    },
  }),
  // Failed actions explain themselves in a toast unless the form shows the error itself (meta.silent)
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return;
      if (isApiError(error) && error.status === 401) return;
      toast.error(error instanceof Error ? error.message : "Something went wrong. Try again.");
      if (!isApiError(error)) reportError(error);
    },
  }),
});

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <AuthProvider>
            <LiveUpdatesProvider>
              <Suspense fallback={<PageSkeleton />}>
                <Routes>
                  {/* Public */}
                  <Route path="/" element={<Login />} />
                  <Route path="/announcements" element={<AllAnnouncements />} />
                  <Route path="/student-login" element={<StudentLogin />} />
                  <Route path="/student-register" element={<StudentRegister />} />
                  <Route path="/verify-email" element={<EmailVerification />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/admin/login" element={<AdminLogin />} />
                  <Route path="/admin/register" element={<RegisterAdmin />} />

                  {/* Students */}
                  <Route element={<ProtectedRoute type="student" />}>
                    <Route path="/student/dashboard" element={<StudentDashboard />} />
                    <Route path="/student/rooms" element={<StudentRooms />} />
                    <Route path="/student/players" element={<FindPlayers />} />
                    <Route path="/student/chat" element={<Chat />} />
                    <Route path="/student/tickets" element={<StudentTickets />} />
                    <Route path="/student/busy-times" element={<BusyTimes role="student" />} />
                    <Route path="/student/profile" element={<StudentProfile />} />
                  </Route>

                  {/* Staff */}
                  <Route element={<ProtectedRoute type="admin" />}>
                    <Route path="/admin/dashboard" element={<AdminDashboard />} />
                    <Route path="/admin/lend" element={<AdminLend />} />
                    <Route path="/admin/equipment" element={<AdminEquipment />} />
                    <Route path="/admin/rooms" element={<AdminRooms />} />
                    <Route path="/admin/tickets" element={<AdminTickets />} />
                    <Route path="/admin/history" element={<AdminHistory />} />
                    <Route path="/admin/announcements" element={<AdminAnnouncements />} />
                    <Route path="/admin/busy-times" element={<BusyTimes role="admin" />} />
                  </Route>

                  {/* Old addresses */}
                  <Route path="/home" element={<Navigate to="/" replace />} />
                  <Route path="/student/complaints" element={<Navigate to="/student/tickets" replace />} />
                  <Route path="/student/analytics" element={<Navigate to="/student/busy-times" replace />} />
                  <Route path="/admin/checkout" element={<Navigate to="/admin/lend" replace />} />
                  <Route path="/admin/assign-equipment" element={<Navigate to="/admin/equipment" replace />} />
                  <Route path="/admin/games" element={<Navigate to="/admin/equipment" replace />} />
                  <Route path="/admin/equipment-history" element={<Navigate to="/admin/history" replace />} />

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </LiveUpdatesProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
