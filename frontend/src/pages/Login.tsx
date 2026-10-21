import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import CourtDiagram from "@/components/CourtDiagram";
import { useAuth } from "@/context/AuthContext";

const Login = () => {
  const { authType, isLoading } = useAuth();
  const dashboardPath = authType === "admin" ? "/admin/dashboard" : "/student/dashboard";

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Court panel: a landscape band on small screens, a full-height column on large ones */}
      <div className="bg-court flex items-center justify-center px-6 py-8 lg:order-2 lg:py-12">
        <CourtDiagram orientation="landscape" className="w-full max-w-sm lg:hidden" />
        <CourtDiagram orientation="portrait" className="hidden lg:block h-[min(78vh,640px)] w-auto" />
      </div>

      <main id="main" className="flex flex-col justify-between px-6 py-10 sm:px-12 lg:px-16 lg:py-14">
        <div className="max-w-md my-auto">
          <h1 className="type-display text-6xl sm:text-7xl text-foreground">Smart SAC</h1>

          <p className="mt-6 text-lg text-muted-foreground max-w-[34ch]">
            The equipment counter at IIIT Allahabad's Student Activity Center, online. Check
            what's free before you walk over, see who has the rest, and find someone to play
            with.
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            {!isLoading && authType ? (
              <Button asChild size="lg">
                <Link to={dashboardPath}>Go to your dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link to="/student-login">Sign in</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/student-register">Create an account</Link>
                </Button>
              </>
            )}
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Use your @iiita.ac.in email to create an account.
          </p>
        </div>

        <p className="mt-12 text-sm text-muted-foreground">
          Work at the SAC desk?{" "}
          <Link to="/admin/login" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
            Staff sign in
          </Link>
        </p>
      </main>
    </div>
  );
};

export default Login;
