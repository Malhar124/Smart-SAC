import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { serverFieldErrors, staffRegisterSchema, validate, type FieldErrors } from "@/lib/schemas";
import AuthLayout from "@/components/AuthLayout";
import { Field, fieldProps } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const RegisterAdmin = () => {
  const navigate = useNavigate();
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = validate(staffRegisterSchema, values);
    setErrors(result.errors ?? {});
    if (!result.data) return;
    setPending(true);
    try {
      await api.post("/admin/register", result.data);
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
          <Input {...fieldProps("email", errors.email)} type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} disabled={pending} />
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
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating account…" : "Create staff account"}
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
