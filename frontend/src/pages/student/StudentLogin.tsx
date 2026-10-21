import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, isApiError } from "@/lib/api";
import { serverFieldErrors, studentLoginSchema, validate, type FieldErrors } from "@/lib/schemas";
import AuthLayout from "@/components/AuthLayout";
import { Field, fieldProps } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const StudentLogin = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const result = validate(studentLoginSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;

    setPending(true);
    try {
      await login("student", result.data);
      toast.success("Signed in");
    } catch (error) {
      if (isApiError(error) && error.code === "EMAIL_NOT_VERIFIED") {
        // Send a fresh code and take them to the confirm step
        const email = String(error.errors.find((x) => x.code)?.email ?? values.email);
        await api.post("/users/resend-verification-email", { email }).catch(() => undefined);
        toast.info("Confirm your email first", { description: "We sent you a new code." });
        navigate(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      setErrors(serverFieldErrors(error));
      setFormError(error instanceof Error ? error.message : "Couldn't sign in. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-3">
        <h1 className="type-title text-5xl">Sign in</h1>
        <p className="text-muted-foreground">Use your @iiita.ac.in email or your username.</p>
      </div>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        {formError && (
          <p className="border-l-4 border-destructive bg-destructive/10 rounded-r-md px-3 py-2 text-sm" role="alert">
            {formError}
          </p>
        )}
        <Field id="email" label="Email or username" error={errors.email}>
          <Input
            {...fieldProps("email", errors.email)}
            autoComplete="username"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            placeholder="you@iiita.ac.in"
            disabled={pending}
            autoFocus
          />
        </Field>
        <Field id="password" label="Password" error={errors.password}>
          <Input
            {...fieldProps("password", errors.password)}
            type="password"
            autoComplete="current-password"
            value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })}
            disabled={pending}
          />
        </Field>
        <div className="flex justify-end text-sm">
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-sm">
          New to Smart SAC?{" "}
          <Link to="/student-register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default StudentLogin;
