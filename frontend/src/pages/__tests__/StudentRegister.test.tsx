import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { renderPage } from "@/test/render";
import StudentRegister from "@/pages/student/StudentRegister";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const fill = async (label: RegExp, value: string) => {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
};

describe("StudentRegister", () => {
  beforeEach(() => vi.mocked(api.post).mockReset());

  it("fills the roll number in from a student email", async () => {
    renderPage(<StudentRegister />);
    await fill(/^email$/i, "iit2023042@iiita.ac.in");
    expect(screen.getByLabelText(/roll number/i)).toHaveValue("IIT2023042");
  });

  it("won't send a roll number that doesn't match the email, then sends the right one", async () => {
    vi.mocked(api.post).mockResolvedValue({ emailDelivered: true });
    renderPage(<StudentRegister />);
    await fill(/full name/i, "Riya Sharma");
    await fill(/username/i, "riya");
    await fill(/^email$/i, "iit2023042@iiita.ac.in");
    await fill(/phone number/i, "9876543210");
    await fill(/roll number/i, "IIT2023043");
    await fill(/^password$/i, "Strong@123");
    await fill(/password again/i, "Strong@123");

    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByText("Your email says your roll number is IIT2023042")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await fill(/roll number/i, "iit2023042");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(api.post).toHaveBeenCalledWith("/users/register", expect.objectContaining({ email: "iit2023042@iiita.ac.in", roll_no: "IIT2023042" }));
  });
});
