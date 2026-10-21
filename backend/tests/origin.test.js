import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, createStaff, prisma, request, resetDatabase, signInStaff } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { testEnv } from "./test-env.js";

beforeEach(resetDatabase);
afterAll(disconnectDB);

const APP_ORIGIN = testEnv.CORS_ORIGIN;

describe("cross-site requests", () => {
  it("refuses a write another site's page sends with the staff member's cookies", async () => {
    const room = await prisma.room.create({ data: { name: "Music Room", capacity: 10 } });
    const desk = await signInStaff(await createStaff());

    const forged = await desk.post(`/api/v1/admin/remove-room/${room.id}`).set("Origin", "https://evil.example");
    expect(forged.status).toBe(403);
    expect(await prisma.room.count()).toBe(1);

    const sandboxed = await desk.post(`/api/v1/admin/remove-room/${room.id}`).set("Origin", "null");
    expect(sandboxed.status).toBe(403);

    const fromApp = await desk.post(`/api/v1/admin/remove-room/${room.id}`).set("Origin", APP_ORIGIN);
    expect(fromApp.status).toBe(200);
  });

  it("accepts writes from the API's own host (the app behind the same proxy)", async () => {
    const res = await request(app)
      .post("/api/v1/users/login")
      .set("Host", "sac.example:8080")
      .set("Origin", "http://sac.example:8080")
      .send({ email: "nobody@iiita.ac.in", password: "x" });
    expect(res.status).toBe(401);
  });

  it("still serves reads to any origin (CORS decides who can see them)", async () => {
    const res = await request(app).get("/api/v1/users/get-announcements").set("Origin", "https://evil.example");
    expect(res.status).toBe(200);
  });

  it("doesn't read form-encoded bodies, which a plain HTML form can send cross-site", async () => {
    const res = await request(app).post("/api/v1/users/login").type("form").send("email=nobody@iiita.ac.in&password=x");
    expect(res.status).toBe(400);
  });
});
