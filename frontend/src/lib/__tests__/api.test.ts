import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, onSessionExpired, setAccountKind } from "@/lib/api";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setAccountKind("student");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAccountKind(null);
    onSessionExpired(null);
  });

  it("returns the data from the response envelope", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: { hello: "world" } }));
    await expect(api.get("/users/dashboard")).resolves.toEqual({ hello: "world" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", credentials: "include" });
  });

  it("turns error responses into ApiError with field errors and a code", async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, {
        success: false,
        message: "Return the football first.",
        errors: [{ code: "BORROWING_BLOCKED", message: "Return the football first." }, { path: "rollNo", message: "Bad roll" }],
      })
    );
    const error = (await api.post("/admin/lend-equipment", {}).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("BORROWING_BLOCKED");
    expect(error.fieldErrors).toEqual({ rollNo: "Bad roll" });
  });

  it("refreshes the session once for several requests that hit 401 together, then retries them", async () => {
    let refreshed = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/users/refresh-token")) {
        refreshed = true;
        return json(200, { success: true, data: {} });
      }
      return refreshed ? json(200, { success: true, data: url }) : json(401, { success: false, message: "expired" });
    });

    const results = await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    expect(results.map(String).map((u) => u.slice(-2))).toEqual(["/a", "/b", "/c"]);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/refresh-token"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("signs out when the refresh fails", async () => {
    const expired = vi.fn();
    onSessionExpired(expired);
    fetchMock.mockResolvedValue(json(401, { success: false, message: "Sign in again." }));
    await expect(api.get("/users/dashboard")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("doesn't try to refresh while signed out", async () => {
    setAccountKind(null);
    fetchMock.mockResolvedValueOnce(json(401, { success: false, message: "Sign in to continue." }));
    await expect(api.get("/users/current-user")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api.get("/users/dashboard")).rejects.toThrow(/Can't reach the Smart SAC server/);
  });
});
