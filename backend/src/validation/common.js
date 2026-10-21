import { z } from "../lib/zod.js";

// Field rules shared by every route. Messages are shown to people as-is, so they say how to fix the input.

export const id = z.string().trim().min(1, "An id is required").max(64, "That id is too long");

export const email = z.string().trim().toLowerCase().email("Enter a valid email address");

export const iiitaEmail = email.refine((value) => value.endsWith("@iiita.ac.in"), {
  message: "Use your @iiita.ac.in email address",
});

export const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/\d/, "Add a number")
  .regex(/[@$!%*?&]/, "Add one of these: @ $ ! % * ? &")
  .regex(/^[A-Za-z\d@$!%*?&]+$/, "Use only letters, numbers and @ $ ! % * ? &");

export const phone = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Phone numbers are 10 digits");

export const rollNo = z
  .string()
  .trim()
  .min(3, "Enter a roll number")
  .max(20, "Roll numbers are at most 20 characters")
  .regex(/^[A-Za-z0-9-]+$/, "Roll numbers use only letters, numbers and dashes")
  .transform((value) => value.toUpperCase());

export const otp = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");

export const shortText = (label, max = 120) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is at most ${max} characters`);

export const longText = (label, max = 2000) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is at most ${max} characters`);

export const page = z.coerce.number().int().min(1).default(1);

export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-11");

export const idParam = (name) => z.object({ [name]: id });
