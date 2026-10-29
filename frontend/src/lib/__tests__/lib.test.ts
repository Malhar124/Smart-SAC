import { describe, expect, it } from "vitest";
import { lendSchema, password, registerSchema, rollNo, validate } from "@/lib/schemas";
import { formatDue, formatHour, formatMinutes, normalizeStatus } from "@/lib/format";
import { bookableHours, buildSlots } from "@/lib/rooms";
import { extractRollNo } from "@/lib/roll";
import { zonedTimeToDate } from "@/lib/time";
import type { Room } from "@/lib/types";

describe("form rules", () => {
  it("explains what a weak password is missing", () => {
    expect(validate(password, "short").errors?.[""]).toBe("Use at least 8 characters");
    expect(validate(password, "alllowercase1@").errors?.[""]).toBe("Add an uppercase letter");
    expect(validate(password, "Strong@123").data).toBe("Strong@123");
  });

  it("upper-cases roll numbers", () => {
    expect(validate(rollNo, " iit2023042 ").data).toBe("IIT2023042");
  });

  it("requires an IIITA email and matching passwords on sign-up", () => {
    const result = validate(registerSchema, {
      fullname: "Riya",
      username: "riya",
      email: "riya@gmail.com",
      phone_number: "9876543210",
      roll_no: "IIT2023001",
      password: "Strong@123",
      confirmPassword: "Strong@124",
    });
    expect(result.errors).toMatchObject({ email: "Use your @iiita.ac.in email address", confirmPassword: "The passwords don't match" });
  });

  it("accepts only a roll-number email on sign-up", () => {
    const result = validate(registerSchema, {
      fullname: "Riya",
      username: "riya",
      email: "riya.sharma@iiita.ac.in",
      phone_number: "9876543210",
      roll_no: "IIT2023001",
      password: "Strong@123",
      confirmPassword: "Strong@123",
    });
    expect(result.errors).toMatchObject({ email: "Use your student email, your roll number @iiita.ac.in" });
  });

  it("checks the lend form", () => {
    expect(validate(lendSchema, { rollNo: "", equipmentId: "", durationMinutes: 5 }).errors).toMatchObject({
      rollNo: "Enter a roll number",
      equipmentId: "Choose an item",
      durationMinutes: "Lend for at least 15 minutes",
    });
  });
});

describe("formatting", () => {
  it("formats durations and hours", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(90)).toBe("1 hr 30 min");
    expect(formatMinutes(120)).toBe("2 hr");
    expect(formatHour(0)).toBe("12 AM");
    expect(formatHour(12)).toBe("12 PM");
    expect(formatHour(17)).toBe("5 PM");
  });

  it("says when something is due or how overdue it is", () => {
    const now = new Date("2026-10-11T12:00:00Z"); // 5:30 PM in India
    expect(formatDue(new Date("2026-10-11T13:00:00Z"), now)).toBe("Due 6:30 PM");
    expect(formatDue(new Date("2026-10-11T11:35:00Z"), now)).toBe("Overdue by 25 min");
  });

  it("reads old and new status spellings", () => {
    expect(normalizeStatus("in-use")).toBe("in_use");
    expect(normalizeStatus("in_use")).toBe("in_use");
    expect(normalizeStatus("available")).toBe("available");
  });
});

describe("room slots", () => {
  const day = "2026-10-12";
  const at = (hour: number) => zonedTimeToDate({ year: 2026, month: 10, day: 12, hour }).toISOString();
  const room: Room = {
    id: "r1",
    name: "Music Room",
    capacity: 10,
    description: null,
    status: "available",
    bookings: [
      { id: "b1", startsAt: at(17), endsAt: at(19), mine: false },
      { id: "b2", startsAt: at(20), endsAt: at(21), mine: true },
    ],
  };

  it("marks each hour free, taken, yours or over", () => {
    const now = new Date(at(9));
    const slots = buildSlots(room, day, 6, 22, now);
    const state = (hour: number) => slots.find((s) => s.hour === hour)?.state;
    expect(state(7)).toBe("past");
    expect(state(9)).toBe("free"); // the current hour can still be booked
    expect(state(17)).toBe("taken");
    expect(state(18)).toBe("taken");
    expect(state(20)).toBe("mine");
    expect(state(21)).toBe("free");
  });

  it("knows how many hours in a row are free", () => {
    const slots = buildSlots(room, day, 6, 22, new Date(at(9)));
    expect(bookableHours(slots, slots.findIndex((s) => s.hour === 15), 2)).toBe(2);
    expect(bookableHours(slots, slots.findIndex((s) => s.hour === 16), 2)).toBe(1);
  });

  it("shows a closed room as closed", () => {
    const slots = buildSlots({ ...room, status: "maintenance", bookings: [] }, day, 6, 22, new Date(at(9)));
    expect(slots.every((s) => s.state === "closed" || s.state === "past")).toBe(true);
  });
});

describe("ID card scanning", () => {
  it("finds the roll number in what a barcode contains", () => {
    expect(extractRollNo("IIT2023042")).toBe("IIT2023042");
    expect(extractRollNo("Name: Riya Sharma | Roll: iit2023042 | Batch 2023")).toBe("IIT2023042");
    expect(extractRollNo("https://example.org/verify?id=MML2022010")).toBe("MML2022010");
    expect(extractRollNo("Hello world, this is not a roll")).toBeNull();
  });
});
