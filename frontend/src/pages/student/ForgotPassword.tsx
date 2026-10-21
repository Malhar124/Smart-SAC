import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/lib/api";
import { email as emailRule, otp, resetPasswordSchema, serverFieldErrors, validate, type FieldErrors } from "@/lib/schemas";
import AuthLayout from "@/components/AuthLayout";
import { Field, fieldProps } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Step = "email" | "code" | "password";

const copy: Record<Step, { title: string; body: (email: string) => string }> = {
  email: { title: "Forgot your password?", body: () => "Enter your account email and we'll send a 6-digit reset code." },
  code: { title: "Enter the code", body: (email) => `We sent a code to ${email}. It works for 10 minutes.` },
  password: { title: "Choose a new password", body: () => "This signs you out everywhere else." },
};

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [passwords, setPasswords] = useState({ newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
    } catch (error) {
      setErrors(serverFieldErrors(error));
      toast.error(error instanceof Error ? error.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    const result = validate(z.object({ email: emailRule }), { email });
    setErrors(result.errors ?? {});
    if (!result.data) return;
    run(async () => {
      await api.post("/users/forgot-password", result.data);
      setEmail(result.data.email);
      setStep("code");
      toast.success("If that account exists, a code is on its way");
    });
  };

  const checkCode = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(z.object({ token: otp }), { token });
    setErrors(result.errors ?? {});
    if (!result.data) return;
    run(async () => {
      await api.post("/users/verify-reset-token", { email, token: result.data.token });
      setStep("password");
    });
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    const result = validate(resetPasswordSchema, passwords);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    run(async () => {
      await api.post("/users/reset-password", { email, token, ...result.data });
      toast.success("Password reset", { description: "Sign in with your new password." });
      navigate("/student-login", { replace: true });
    });
  };

  return (
    <AuthLayout>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground tabular">
          Step {step === "email" ? 1 : step === "code" ? 2 : 3} of 3
        </p>
        <h1 className="type-title text-5xl">{copy[step].title}</h1>
        <p className="text-muted-foreground">{copy[step].body(email)}</p>
      </div>

      {step === "email" && (
        <form onSubmit={sendCode} className="mt-8 space-y-4" noValidate>
          <Field id="email" label="Email" error={errors.email}>
            <Input {...fieldProps("email", errors.email)} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Send reset code"}
          </Button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={checkCode} className="mt-8 space-y-4" noValidate>
          <Field id="token" label="Code" error={errors.token}>
            <Input
              {...fieldProps("token", errors.token)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
              className="tabular tracking-[0.3em] text-lg"
              autoFocus
            />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Checking…" : "Continue"}
          </Button>
          <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => sendCode()} disabled={pending}>
            Send a new code
          </Button>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={reset} className="mt-8 space-y-4" noValidate>
          <Field id="newPassword" label="New password" error={errors.newPassword} hint="8+ characters with upper and lower case, a number and one of @ $ ! % * ? &">
            <Input
              {...fieldProps("newPassword", errors.newPassword, true)}
              type="password"
              autoComplete="new-password"
              value={passwords.newPassword}
              onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
              autoFocus
            />
          </Field>
          <Field id="confirmPassword" label="New password again" error={errors.confirmPassword}>
            <Input
              {...fieldProps("confirmPassword", errors.confirmPassword)}
              type="password"
              autoComplete="new-password"
              value={passwords.confirmPassword}
              onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Reset password"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-sm">
        <Link to="/student-login" className="text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
};

export default ForgotPassword;
