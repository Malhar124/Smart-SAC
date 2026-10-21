import { z } from "zod";
import { isApiError } from "@/lib/api";

// Form rules, mirroring backend/src/validation/common.js so people see the same message before
// and after submitting. The server stays the authority: its field errors are shown the same way.

export const iiitaEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .refine((v) => v.endsWith("@iiita.ac.in"), "Use your @iiita.ac.in email address");

export const email = z.string().trim().toLowerCase().email("Enter a valid email address");

export const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/\d/, "Add a number")
  .regex(/[@$!%*?&]/, "Add one of these: @ $ ! % * ? &")
  .regex(/^[A-Za-z\d@$!%*?&]+$/, "Use only letters, numbers and @ $ ! % * ? &");

export const phone = z.string().trim().regex(/^\d{10}$/, "Phone numbers are 10 digits");

export const rollNo = z
  .string()
  .trim()
  .min(3, "Enter a roll number")
  .max(20, "Roll numbers are at most 20 characters")
  .regex(/^[A-Za-z0-9-]+$/, "Roll numbers use only letters, numbers and dashes")
  .transform((v) => v.toUpperCase());

/** Student emails at IIITA are the roll number (iit2023001@iiita.ac.in); null for other addresses */
export const rollNoFromEmail = (email: string) => {
  const local = email.trim().split("@")[0];
  return /^[a-z]{3}\d{7}$/i.test(local) ? local.toUpperCase() : null;
};

export const otp = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is at most ${max} characters`);

export const registerSchema = z
  .object({
    fullname: required("Full name", 80),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "Usernames are at least 3 characters")
      .max(30, "Usernames are at most 30 characters")
      .regex(/^[a-z0-9_.]+$/, "Use only letters, numbers, dots and underscores"),
    email: iiitaEmail,
    phone_number: phone,
    roll_no: rollNo,
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "The passwords don't match" })
  .superRefine((v, ctx) => {
    const fromEmail = rollNoFromEmail(v.email);
    if (fromEmail && v.roll_no !== fromEmail) {
      ctx.addIssue({ code: "custom", path: ["roll_no"], message: `Your email says your roll number is ${fromEmail}` });
    }
  });

export const studentLoginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email or username"),
  password: z.string().min(1, "Enter your password"),
});

export const staffLoginSchema = z.object({ email, password: z.string().min(1, "Enter your password") });

export const staffRegisterSchema = z.object({ name: required("Name", 60), email, password });

export const resetPasswordSchema = z
  .object({ newPassword: password, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "The passwords don't match" });

export const changePasswordSchema = z
  .object({ oldPassword: z.string().min(1, "Enter your current password"), newPassword: password, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "The passwords don't match" })
  .refine((v) => v.newPassword !== v.oldPassword, { path: ["newPassword"], message: "Choose a different password" });

export const lendSchema = z.object({
  rollNo,
  equipmentId: z.string().min(1, "Choose an item"),
  durationMinutes: z.number().int().min(15, "Lend for at least 15 minutes").max(480, "Lend for at most 8 hours"),
});

export const brokenTicketSchema = z.object({
  equipmentId: z.string().min(1, "Choose the item"),
  heading: required("What's wrong", 120),
  content: required("Details", 2000),
});

export const requestTicketSchema = z.object({
  game: required("Game", 60),
  equipment: required("Equipment", 80),
  heading: required("Why it's needed", 120),
  details: required("Details", 2000),
});

export const announcementSchema = z.object({
  heading: required("Heading", 120),
  content: required("Message", 2000),
  expiresInDays: z.number().int().min(1, "At least a day").max(365, "At most a year"),
});

export const roomSchema = z.object({
  name: required("Room name", 60),
  capacity: z.number({ invalid_type_error: "Enter a number" }).int().min(1, "Capacity is at least 1").max(500, "Capacity is at most 500"),
  description: z.string().trim().max(200, "Keep it under 200 characters").optional(),
});

// The roll number isn't here: it's fixed at sign-up because loans and borrowing blocks are kept by it
export const profileSchema = z.object({
  fullname: required("Full name", 80),
  phone_number: phone,
});

export type FieldErrors = Record<string, string>;

/** Validate form values: { data } on success, { errors } (field -> first message) on failure */
export const validate = <T extends z.ZodTypeAny>(
  schema: T,
  values: unknown
): { data: z.infer<T>; errors?: undefined } | { data?: undefined; errors: FieldErrors } => {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".");
    if (!errors[key]) errors[key] = issue.message;
  }
  return { errors };
};

/** Field errors from a failed API call (empty when the error isn't about specific fields) */
export const serverFieldErrors = (error: unknown): FieldErrors => (isApiError(error) ? error.fieldErrors : {});
