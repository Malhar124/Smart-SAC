import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FieldProps {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Label, control and message for one form field. Give the control `{...fieldProps(id, error, hint)}`
 * so screen readers announce the hint and any error with it.
 */
export const Field = ({ id, label, error, hint, className, children }: FieldProps) => (
  <div className={cn("space-y-2", className)}>
    <Label htmlFor={id}>{label}</Label>
    {children}
    {hint && !error && (
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {hint}
      </p>
    )}
    {error && (
      <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
        {error}
      </p>
    )}
  </div>
);

export const fieldProps = (id: string, error?: string, hint?: boolean) => ({
  id,
  name: id,
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
});
