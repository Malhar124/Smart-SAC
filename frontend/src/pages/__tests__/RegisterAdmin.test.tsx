import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { renderPage } from "@/test/render";
import RegisterAdmin from "@/pages/admin/RegisterAdmin";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe("RegisterAdmin", () => {
  it("emails a code first, then sets the password with it (a new account or a reset)", async () => {
    vi.mocked(api.post).mockResolvedValue({});
    renderPage(<RegisterAdmin />);
    await userEvent.type(screen.getByLabelText(/your name/i), "Desk Staff");
    await userEvent.type(screen.getByLabelText(/^email$/i), "Desk@iiita.ac.in");
    await userEvent.type(screen.getByLabelText(/^password$/i), "Strong@123");

    await userEvent.click(screen.getByRole("button", { name: /email me a code/i }));
    expect(api.post).toHaveBeenLastCalledWith("/admin/register", { email: "desk@iiita.ac.in" });

    await userEvent.type(await screen.findByLabelText(/code from the email/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));
    expect(api.post).toHaveBeenLastCalledWith("/admin/confirm-registration", {
      name: "Desk Staff",
      email: "desk@iiita.ac.in",
      password: "Strong@123",
      token: "123456",
    });
  });
});
