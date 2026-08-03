import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiService } from "@/services/apiService";
import { API_BASE_URL } from "@/config/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiService browser session handling", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    dispatchSpy = vi.spyOn(window, "dispatchEvent");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("refreshes an expired cookie session and retries the profile request", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          user: {
            id: "user-1",
            email: "reader@example.com",
          },
        }),
      );

    await expect(ApiService.getUser("COOKIE_SESSION")).resolves.toEqual({
      user: {
        id: "user-1",
        email: "reader@example.com",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/user/profile`);
    expect(fetchMock.mock.calls[1]).toEqual([
      `${API_BASE_URL}/auth/refresh`,
      {
        method: "POST",
        credentials: "include",
      },
    ]);
    expect(fetchMock.mock.calls[2][0]).toBe(`${API_BASE_URL}/user/profile`);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("preserves the session when an authenticated action is forbidden", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Notebook access denied" }, 403),
    );

    await expect(ApiService.getUser("ordinary-session")).rejects.toThrow(
      "Notebook access denied",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("signals logout only after cookie refresh fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: "Refresh expired" }, 401));

    await expect(ApiService.getUser("COOKIE_SESSION")).rejects.toThrow(
      "Authentication expired or invalid",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect((dispatchSpy.mock.calls[0][0] as CustomEvent).type).toBe(
      "auth:unauthorized",
    );
  });
});
