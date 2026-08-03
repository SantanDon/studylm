import { beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  default: { lookup: dns.lookup },
  lookup: dns.lookup,
}));

const { assertSafeExternalHttpsUrl, isPublicIpAddress, parseExternalHttpsUrl } =
  await import("../utils/externalUrlSafety.js");
const { fetchPublicUrl } = await import("../services/extractionService.js");

describe("external URL safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies private, local, documentation, and public IP ranges", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.2",
      "172.31.255.1",
      "192.168.1.1",
      "192.0.2.10",
      "198.51.100.4",
      "203.0.113.9",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }

    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("requires standard HTTPS without credentials or local hosts", () => {
    for (const value of [
      "http://example.com/hook",
      "https://user:pass@example.com/hook",
      "https://example.com:8443/hook",
      "https://localhost/hook",
      "https://service.local/hook",
      "https://10.0.0.1/hook",
    ]) {
      expect(() => parseExternalHttpsUrl(value), value).toThrow();
    }

    expect(parseExternalHttpsUrl("https://example.com/hook").toString()).toBe(
      "https://example.com/hook",
    );
  });

  it("rejects hostnames that resolve to any private address", async () => {
    dns.lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);

    await expect(
      assertSafeExternalHttpsUrl("https://example.com/hook"),
    ).rejects.toThrow(/exclusively to public addresses/i);
  });

  it("accepts a hostname only when every resolved address is public", async () => {
    dns.lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);

    await expect(
      assertSafeExternalHttpsUrl("https://example.com/hook"),
    ).resolves.toBe("https://example.com/hook");
  });

  it("rejects redirects into private networks before the next request", async () => {
    dns.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const destroy = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 302,
      headers: {
        get: vi.fn().mockReturnValue("https://127.0.0.1/private"),
      },
      body: { destroy },
    });

    await expect(
      fetchPublicUrl("https://example.com/start", {}, fetchImpl),
    ).rejects.toThrow(/private|reserved/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("revalidates and follows bounded public redirects", async () => {
    dns.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const finalResponse = {
      status: 200,
      headers: { get: vi.fn() },
      body: null,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: vi.fn().mockReturnValue("/next") },
        body: { destroy: vi.fn() },
      })
      .mockResolvedValueOnce(finalResponse);

    await expect(
      fetchPublicUrl("https://example.com/start", {}, fetchImpl),
    ).resolves.toBe(finalResponse);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.com/next",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
