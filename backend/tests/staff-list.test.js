import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { app, createStaff, request, resetDatabase, signInStaff, PASSWORD } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { env } from "../src/config/env.js";

const LIST = env.ADMIN_EMAILS;

beforeEach(resetDatabase);
afterEach(() => {
  env.ADMIN_EMAILS = LIST;
});
afterAll(disconnectDB);

describe("the staff list (ADMIN_EMAILS)", () => {
  it("takes access away from someone removed from it, without waiting for their session to expire", async () => {
    const staff = await createStaff();
    const desk = await signInStaff(staff);
    expect((await desk.get("/api/v1/admin/dashboard")).status).toBe(200);

    env.ADMIN_EMAILS = "office@iiita.ac.in";
    expect((await desk.get("/api/v1/admin/dashboard")).status).toBe(401);
    expect((await desk.post("/api/v1/admin/refresh-token")).status).toBe(401);
    const login = await request(app).post("/api/v1/admin/login").send({ email: staff.email, password: PASSWORD });
    expect(login.status).toBe(403);
  });

  it("doesn't say whether an email is staff to someone without the password", async () => {
    const staff = await createStaff();
    env.ADMIN_EMAILS = "office@iiita.ac.in";
    const login = await request(app).post("/api/v1/admin/login").send({ email: staff.email, password: "Wrong@123" });
    expect(login.status).toBe(401);
  });

  it("limits the email a staff member can switch their account to", async () => {
    const desk = await signInStaff(await createStaff());
    const outside = await desk.post("/api/v1/admin/update-account-details").send({ email: "someone@iiita.ac.in" });
    expect(outside.status).toBe(400);
    expect(outside.body.errors[0].path).toBe("email");

    env.ADMIN_EMAILS = `${LIST},office@iiita.ac.in`;
    const listed = await desk.post("/api/v1/admin/update-account-details").send({ email: "office@iiita.ac.in", name: "Front Office" });
    expect(listed.status).toBe(200);
    expect(listed.body.data).toMatchObject({ email: "office@iiita.ac.in", name: "Front Office" });
  });
});
