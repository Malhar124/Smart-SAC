import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { otp, serverFieldErrors, staffRegisterSchema, validate, type FieldErrors } from "@/lib/schemas";
import AuthLayout from "@/components/AuthLayout";
import { Field, fieldProps } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const RegisterAdmin = () => {
  const navigate = useNavigate();
  const [values, setValues] = useState({ name: "", email: "", password: "", token: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  // The account is created only with the code emailed to the staff address
  const [codeSent, setCodeSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const schema = codeSent ? staffRegisterSchema.extend({ token: otp }) : staffRegisterSchema;
    const result = validate(schema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    setPending(true);
    try {
      if (!codeSent) {
        await api.post("/admin/register", { email: result.data.email });
        setCodeSent(true);
        toast.success("Code sent", { description: `Check ${result.data.email} for a 6-digit code.` });
        return;
      }
      await api.post("/admin/confirm-registration", result.data);
      toast.success("Staff account created", { description: "Sign in to open the desk." });
      navigate("/admin/login");
    } catch (error) {
      setErrors(serverFieldErrors(error));
      toast.error(error instanceof Error ? error.message : "Couldn't create the account.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-3">
        <h1 className="type-title text-5xl">Create a staff account</h1>
        <p className="text-muted-foreground">Your email must be on the SAC staff list. Your name appears on loans and ticket replies.</p>
      </div>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <Field id="name" label="Your name" error={errors.name}>
          <Input {...fieldProps("name", errors.name)} autoComplete="name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} disabled={pending} autoFocus />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <Input
            {...fieldProps("email", errors.email)}
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            disabled={pending || codeSent}
          />
        </Field>
        <Field id="password" label="Password" error={errors.password} hint="8+ characters with upper and lower case, a number and one of @ $ ! % * ? &">
          <Input
            {...fieldProps("password", errors.password, true)}
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })}
            disabled={pending}
          />
        </Field>
        {codeSent && (
          <Field id="token" label="Code from the email" error={errors.token}>
            <Input
              {...fieldProps("token", errors.token)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={values.token}
              onChange={(e) => setValues({ ...values, token: e.target.value.replace(/\D/g, "") })}
              placeholder="123456"
              className="tabular tracking-[0.3em] text-lg"
              disabled={pending}
              autoFocus
            />
          </Field>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {codeSent ? (pending ? "Creating account…" : "Create staff account") : pending ? "Sending code…" : "Email me a code"}
        </Button>
        <p className="text-center text-sm">
          Already have one?{" "}
          <Link to="/admin/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default RegisterAdmin;
