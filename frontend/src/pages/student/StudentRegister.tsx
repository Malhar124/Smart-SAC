import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { registerSchema, serverFieldErrors, validate, type FieldErrors } from "@/lib/schemas";
import AuthLayout from "@/components/AuthLayout";
import { Field, fieldProps } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const empty = { fullname: "", username: "", email: "", phone_number: "", roll_no: "", password: "", confirmPassword: "" };

const StudentRegister = () => {
  const navigate = useNavigate();
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const set = (key: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = validate(registerSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;

    setPending(true);
    try {
      const { confirmPassword: _confirm, ...body } = result.data;
      const response = await api.post<{ emailDelivered: boolean }>("/users/register", body);
      toast.success("Account created", {
        description: response.emailDelivered ? "Check your email for a 6-digit code." : "Enter the 6-digit code to finish.",
      });
      navigate(`/verify-email?email=${encodeURIComponent(result.data.email)}${response.emailDelivered ? "" : "&dev=1"}`);
    } catch (error) {
      setErrors(serverFieldErrors(error));
      toast.error(error instanceof Error ? error.message : "Couldn't create the account. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout wide>
      <div className="space-y-3">
        <h1 className="type-title text-5xl">Create your account</h1>
        <p className="text-muted-foreground">Use your @iiita.ac.in email. We'll send a code to confirm it.</p>
      </div>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="fullname" label="Full name" error={errors.fullname}>
            <Input {...fieldProps("fullname", errors.fullname)} autoComplete="name" value={values.fullname} onChange={set("fullname")} disabled={pending} />
          </Field>
          <Field id="username" label="Username" error={errors.username}>
            <Input {...fieldProps("username", errors.username)} autoComplete="username" value={values.username} onChange={set("username")} disabled={pending} />
          </Field>
        </div>
        <Field id="email" label="Email" error={errors.email}>
          <Input
            {...fieldProps("email", errors.email)}
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            placeholder="iit2023001@iiita.ac.in"
            disabled={pending}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="phone_number" label="Phone number" error={errors.phone_number}>
            <Input
              {...fieldProps("phone_number", errors.phone_number)}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={values.phone_number}
              onChange={set("phone_number")}
              placeholder="10 digits"
              disabled={pending}
            />
          </Field>
          <Field id="roll_no" label="Roll number" error={errors.roll_no}>
            <Input {...fieldProps("roll_no", errors.roll_no)} value={values.roll_no} onChange={set("roll_no")} placeholder="IIT2023001" disabled={pending} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="password" label="Password" error={errors.password} hint="8+ characters with upper and lower case, a number and one of @ $ ! % * ? &">
            <Input {...fieldProps("password", errors.password, true)} type="password" autoComplete="new-password" value={values.password} onChange={set("password")} disabled={pending} />
          </Field>
          <Field id="confirmPassword" label="Password again" error={errors.confirmPassword}>
            <Input
              {...fieldProps("confirmPassword", errors.confirmPassword)}
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              onChange={set("confirmPassword")}
              disabled={pending}
            />
          </Field>
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-center text-sm">
          Already have an account?{" "}
          <Link to="/student-login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default StudentRegister;
