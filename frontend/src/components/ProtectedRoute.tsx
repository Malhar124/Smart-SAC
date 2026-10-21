import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { PageSkeleton } from "@/components/states";

/** Pages for one kind of account; anyone else is sent to the matching sign-in page and brought back after */
const ProtectedRoute = ({ type }: { type: "student" | "admin" }) => {
  const { authType, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <PageSkeleton />;

  if (authType !== type) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={type === "student" ? `/student-login?next=${next}` : `/admin/login?next=${next}`} replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
