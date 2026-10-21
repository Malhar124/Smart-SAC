import { describe, expect, it } from "vitest";
import { toDateKey, zonedParts, zonedTimeToDate } from "../src/lib/time.js";

describe("time zone helpers", () => {
  it("converts SAC wall-clock time to an instant and back", () => {
    const instant = zonedTimeToDate({ year: 2026, month: 10, day: 11, hour: 18, minute: 30 }, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-10-11T13:00:00.000Z");
    expect(zonedParts(instant, "Asia/Kolkata")).toMatchObject({ year: 2026, month: 10, day: 11, hour: 18, minute: 30 });
  });

  it("handles zones with daylight saving", () => {
    // 2026-03-29 is the day Europe/London moves to BST
    const morning = zonedTimeToDate({ year: 2026, month: 3, day: 29, hour: 9 }, "Europe/London");
    expect(morning.toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });

  it("formats a local date key", () => {
    // 20:00 UTC is already the next day in India
    expect(toDateKey(new Date("2026-10-10T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10-11");
  });
});
