import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { serverFieldErrors, staffLoginSchema, validate, type FieldErrors } from "@/lib/schemas";
import AuthLayout from "@/components/AuthLayout";
import { Field, fieldProps } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const AdminLogin = () => {
  const { login } = useAuth();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const result = validate(staffLoginSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    setPending(true);
    try {
      await login("admin", result.data);
      toast.success("Signed in");
    } catch (error) {
      setErrors(serverFieldErrors(error));
      setFormError(error instanceof Error ? error.message : "Couldn't sign in. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-3">
        <h1 className="type-title text-5xl">Staff sign in</h1>
        <p className="text-muted-foreground">For SAC desk staff. Students sign in from the main page.</p>
      </div>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        {formError && (
          <p className="border-l-4 border-destructive bg-destructive/10 rounded-r-md px-3 py-2 text-sm" role="alert">
            {formError}
          </p>
        )}
        <Field id="email" label="Email" error={errors.email}>
          <Input {...fieldProps("email", errors.email)} type="email" autoComplete="username" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} disabled={pending} autoFocus />
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
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center text-sm">
          First time at the desk, or forgot your password?{" "}
          <Link to="/admin/register" className="font-medium text-primary hover:underline">
            Get an email code
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default AdminLogin;
