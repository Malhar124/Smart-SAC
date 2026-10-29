import { describe, expect, it } from "vitest";
import { createAuthLimiters } from "../src/middlewares/rateLimit.middleware.js";

// The limiter is off for the rest of the suite (tests sign in many times), so it's tested directly here

/** Run the middleware chain for one request; resolves to the status it would answer with */
const send = async (limiters, req) => {
  for (const limiter of limiters) {
    const error = await new Promise((resolve) => limiter(req, { set() {} }, resolve));
    if (error) return error.statusCode;
  }
  return 200;
};

const signIn = (email) => ({ ip: "203.0.113.7", baseUrl: "/api/v1/users", path: "/login", body: { email } });

describe("sign-in rate limit", () => {
  it("lets many students behind one campus address sign in", async () => {
    const limiters = createAuthLimiters();
    for (let i = 1; i <= 30; i += 1) {
      expect(await send(limiters, signIn(`iit2023${String(i).padStart(3, "0")}@iiita.ac.in`))).toBe(200);
    }
  });

  it("still stops repeated attempts at one account", async () => {
    const limiters = createAuthLimiters();
    for (let i = 0; i < 10; i += 1) expect(await send(limiters, signIn("iit2023001@iiita.ac.in"))).toBe(200);
    expect(await send(limiters, signIn("IIT2023001@iiita.ac.in"))).toBe(429);
    expect(await send(limiters, signIn("iit2023002@iiita.ac.in"))).toBe(200);
  });
});
