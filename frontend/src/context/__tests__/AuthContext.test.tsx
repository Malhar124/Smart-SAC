import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api, ApiError } from "@/lib/api";
import { answer, renderPage } from "@/test/render";
import { AuthProvider, useAuth } from "@/context/AuthContext";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const Probe = () => {
  const { admin, isLoading, logout } = useAuth();
  if (isLoading) return null;
  return admin ? <button onClick={logout}>Sign out {admin.name}</button> : <p>Signed out</p>;
};

const signInAsStaff = () => {
  vi.mocked(api.get).mockImplementation(
    answer({ "/admin/current-admin": { id: "s1", email: "desk@iiita.ac.in", name: "Desk Staff" } }) as typeof api.get
  );
  renderPage(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
};

describe("signing out", () => {
  it("stays signed in when the server can't be reached, because the session cookies still work", async () => {
    signInAsStaff();
    vi.mocked(api.post).mockRejectedValue(new ApiError(0, "Can't reach the Smart SAC server."));

    await userEvent.click(await screen.findByRole("button", { name: /sign out desk staff/i }));

    expect(api.post).toHaveBeenCalledWith("/admin/logout");
    expect(screen.getByRole("button", { name: /sign out desk staff/i })).toBeInTheDocument();
  });

  it("signs out here when the server says the session already ended", async () => {
    signInAsStaff();
    vi.mocked(api.post).mockRejectedValue(new ApiError(401, "Your session ended. Sign in again."));

    await userEvent.click(await screen.findByRole("button", { name: /sign out desk staff/i }));

    expect(await screen.findByText(/signed out/i)).toBeInTheDocument();
  });
});
