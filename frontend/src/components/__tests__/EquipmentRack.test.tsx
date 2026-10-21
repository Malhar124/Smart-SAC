import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EquipmentRack } from "@/components/EquipmentRegister";
import type { StudentEquipmentItem } from "@/lib/types";

const base = { games: [], holder: null, issuedAt: null, dueAt: null, overdue: false, reservation: null };
const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const items: StudentEquipmentItem[] = [
  { ...base, id: "free", name: "chess set 1", status: "available" },
  { ...base, id: "mine", name: "football 1", status: "available", reservation: { mine: true, until: inAnHour } },
  { ...base, id: "theirs", name: "volleyball 1", status: "available", reservation: { mine: false, until: inAnHour } },
  { ...base, id: "out", name: "badminton racket 1", status: "in_use", holder: { name: "Aarav Mehta", rollNo: "IIT2023002", phone: "9876543210" }, dueAt: inAnHour },
  { ...base, id: "broken", name: "snooker cue 3", status: "broken" },
];

describe("EquipmentRack", () => {
  it("describes every tag for screen readers", () => {
    render(<EquipmentRack items={items} />);
    expect(screen.getByRole("listitem", { name: /chess set 1: free/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /football 1: held for you/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /volleyball 1: reserved until/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /badminton racket 1: out with Aarav Mehta. Due/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /snooker cue 3: broken/i })).toBeInTheDocument();
  });

  it("reserves a free item and cancels your own hold", async () => {
    const onReserve = vi.fn();
    const onCancel = vi.fn();
    render(<EquipmentRack items={items} onReserve={onReserve} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Reserve chess set 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel reservation for football 1" }));
    expect(onReserve).toHaveBeenCalledWith("free");
    expect(onCancel).toHaveBeenCalledWith("mine");
  });

  it("disables reserving while borrowing is blocked, and says why", () => {
    render(<EquipmentRack items={items} onReserve={vi.fn()} blockedReason="Return the football first." />);
    const button = screen.getByRole("button", { name: "Reserve chess set 1" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Return the football first.");
  });

  it("calls the item out yours when you have it", () => {
    render(<EquipmentRack items={items} myRollNo="IIT2023002" />);
    expect(screen.getByText("You have it")).toBeInTheDocument();
  });
});
