import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { email as emailRule, otp, serverFieldErrors, validate, type FieldErrors } from "@/lib/schemas";
import { z } from "zod";
import AuthLayout from "@/components/AuthLayout";
import { Field, fieldProps } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const schema = z.object({ email: emailRule, token: otp });
const RESEND_COOLDOWN = 60;

const EmailVerification = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [values, setValues] = useState({ email: params.get("email") ?? "", token: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const devFallback = params.get("dev") === "1";

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = validate(schema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    setPending(true);
    try {
      await api.post("/users/verify-email", result.data);
      toast.success("Email confirmed", { description: "Sign in to get started." });
      navigate("/student-login", { replace: true });
    } catch (error) {
      setErrors({ token: error instanceof Error ? error.message : "That code didn't work.", ...serverFieldErrors(error) });
    } finally {
      setPending(false);
    }
  };

  const resend = async () => {
    const result = validate(z.object({ email: emailRule }), { email: values.email });
    if (!result.data) {
      setErrors(result.errors ?? {});
      return;
    }
    try {
      await api.post("/users/resend-verification-email", result.data);
      toast.success("New code sent", { description: "Check your email. Codes last 24 hours." });
      setCooldown(RESEND_COOLDOWN);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't send a new code.");
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-3">
        <h1 className="type-title text-5xl">Check your email</h1>
        <p className="text-muted-foreground">
          {values.email ? `Enter the 6-digit code we sent to ${values.email}.` : "Enter your email and the 6-digit code we sent you."}
        </p>
        {(devFallback || import.meta.env.DEV) && (
          <p className="text-sm text-muted-foreground border-l-4 border-line pl-3">
            Running locally? If email isn't set up, the code is printed in the backend terminal.
          </p>
        )}
      </div>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        {!params.get("email") && (
          <Field id="email" label="Email" error={errors.email}>
            <Input {...fieldProps("email", errors.email)} type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
          </Field>
        )}
        <Field id="token" label="Code" error={errors.token}>
          <Input
            {...fieldProps("token", errors.token)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={values.token}
            onChange={(e) => setValues({ ...values, token: e.target.value.replace(/\D/g, "") })}
            placeholder="123456"
            className="tabular tracking-[0.3em] text-lg"
            autoFocus
          />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Confirming…" : "Confirm email"}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <Button type="button" variant="link" className="h-auto p-0" onClick={resend} disabled={cooldown > 0}>
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
          </Button>
          <Link to="/student-login" className="text-muted-foreground hover:text-foreground">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
};

export default EmailVerification;
