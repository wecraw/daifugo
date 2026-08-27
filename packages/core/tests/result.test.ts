import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok, type Result } from "../src/types.js";

describe("Result", () => {
  it("constructs ok", () => {
    const r: Result<number, "NOT_YOUR_TURN"> = ok(1);
    expect(r).toEqual({ ok: true, value: 1 });
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  it("constructs err", () => {
    const r: Result<number, "NOT_YOUR_TURN"> = err("NOT_YOUR_TURN");
    expect(r).toEqual({ ok: false, error: "NOT_YOUR_TURN" });
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  it("narrows on the discriminant", () => {
    const r: Result<number, "NOT_YOUR_TURN"> = ok(42);
    expect(r.ok ? r.value : -1).toBe(42);
  });
});
