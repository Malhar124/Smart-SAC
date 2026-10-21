import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { answer, renderPage } from "@/test/render";
import type { CurrentStudent } from "@/lib/types";
import StudentProfile from "@/pages/student/Profile";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me" }, admin: null, authType: "student", isLoading: false, login: vi.fn(), logout: vi.fn(), reload: vi.fn() }),
}));

const me: CurrentStudent = {
  userDetails: {
    id: "me",
    fullname: "Riya Sharma",
    email: "iit2023042@iiita.ac.in",
    username: "riya",
    roll_no: "IIT2023042",
    phone_number: "9876543210",
    achievements: [],
    games: [],
  },
  loans: [],
  standing: { rollNo: "IIT2023042", lateReturns: 0, windowDays: 30, limit: 3, graceMinutes: 10, blocked: false, reason: null, blockedUntil: null, message: null, overdue: [] },
  reservation: null,
  roomBookings: [],
};

describe("StudentProfile", () => {
  it("edits name and phone but not the roll number", async () => {
    vi.mocked(api.get).mockImplementation(
      answer({ "/users/current-user": me, "/users/get-games": [], "/users/get-notifications?limit=30": { notifications: [], unread: 0 } }) as typeof api.get
    );
    vi.mocked(api.post).mockResolvedValue({});
    renderPage(<StudentProfile />);

    await userEvent.click(await screen.findByRole("button", { name: /edit profile/i }));
    expect(screen.queryByRole("textbox", { name: /roll number/i })).not.toBeInTheDocument();
    expect(screen.getByText(/roll number \(IIT2023042\) can't be changed/i)).toBeInTheDocument();

    const name = screen.getByRole("textbox", { name: /full name/i });
    await userEvent.clear(name);
    await userEvent.type(name, "Riya S");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(api.post).toHaveBeenCalledWith("/users/update-account-details", expect.objectContaining({ fullname: "Riya S", phone_number: "9876543210" }));
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("roll_no");
  });
});
