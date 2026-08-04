import { describe, expect, it } from "vitest";
import { validateProductionEnvironment } from "../../../scripts/validate-production-env.mjs";

describe("production deployment environment validation", () => {
  it("skips validation outside a Vercel production build", () => {
    expect(
      validateProductionEnvironment({ VERCEL: "1", VERCEL_ENV: "preview" }),
    ).toEqual({ checked: false, environment: "preview" });
  });

  it("rejects a missing or undersized JWT signing secret", () => {
    expect(() =>
      validateProductionEnvironment({
        VERCEL: "1",
        VERCEL_ENV: "production",
        JWT_SECRET: "too-short",
      }),
    ).toThrow(/at least 32 characters/i);
  });

  it("accepts a production JWT signing secret at or above the minimum", () => {
    expect(
      validateProductionEnvironment({
        VERCEL: "1",
        VERCEL_ENV: "production",
        JWT_SECRET: "x".repeat(32),
      }),
    ).toEqual({ checked: true, environment: "production" });
  });
});
