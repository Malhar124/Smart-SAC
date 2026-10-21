import { afterAll, beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { app, cookieValue, createStaff, createStudent, prisma, request, resetDatabase, signInStaff, signInStudent, PASSWORD } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { runCleanup } from "../src/jobs/index.js";
import { env } from "../src/config/env.js";

beforeEach(resetDatabase);
afterAll(disconnectDB);

const me = (agent) => agent.get("/api/v1/users/current-user");
const refresh = (agent) => agent.post("/api/v1/users/refresh-token");

describe("sessions", () => {
  it("keep each device signed in on its own", async () => {
    const student = await createStudent();
    const laptop = await signInStudent(student);
    const phone = await signInStudent(student);
    expect(await prisma.session.count({ where: { userId: student.id } })).toBe(2);

    expect((await refresh(laptop)).status).toBe(200);
    expect((await refresh(phone)).status).toBe(200);
    expect((await me(laptop)).status).toBe(200);
    expect((await me(phone)).status).toBe(200);
  });

  it("store only a hash of the refresh token", async () => {
    const student = await createStudent();
    const agent = request.agent(app);
    const token = cookieValue(await agent.post("/api/v1/users/login").send({ email: student.email, password: PASSWORD }), "refreshToken");
    const session = await prisma.session.findFirst({ where: { userId: student.id } });
    expect(session.tokenHash).not.toContain(token);
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("end when an old refresh token is replayed, for whoever holds it", async () => {
    const student = await createStudent();
    const agent = request.agent(app);
    const stolen = cookieValue(await agent.post("/api/v1/users/login").send({ email: student.email, password: PASSWORD }), "refreshToken");
    expect((await refresh(agent)).status).toBe(200);

    const replay = await request(app).post("/api/v1/users/refresh-token").send({ refreshToken: stolen });
    expect(replay.status).toBe(401);
    // The real owner's newer token and access token stop working too: the session is gone
    expect((await refresh(agent)).status).toBe(401);
    expect((await me(agent)).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it("let only one of two refreshes racing with the same token through", async () => {
    const student = await createStudent();
    const agent = request.agent(app);
    const token = cookieValue(await agent.post("/api/v1/users/login").send({ email: student.email, password: PASSWORD }), "refreshToken");
    const results = await Promise.all([0, 1].map(() => request(app).post("/api/v1/users/refresh-token").send({ refreshToken: token })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("sign out only the device that signs out", async () => {
    const student = await createStudent();
    const laptop = await signInStudent(student);
    const phone = await signInStudent(student);
    expect((await laptop.post("/api/v1/users/logout")).status).toBe(200);
    expect((await me(laptop)).status).toBe(401);
    expect((await refresh(laptop)).status).toBe(401);
    expect((await me(phone)).status).toBe(200);
  });

  it("on other devices end when the password is changed", async () => {
    const student = await createStudent();
    const laptop = await signInStudent(student);
    const phone = await signInStudent(student);
    const res = await laptop.post("/api/v1/users/change-password").send({ oldPassword: PASSWORD, newPassword: "Another@1" });
    expect(res.status).toBe(200);
    expect((await me(phone)).status).toBe(401);
    expect((await me(laptop)).status).toBe(200);
  });

  it("all end when the password is reset", async () => {
    const student = await createStudent();
    const agent = await signInStudent(student);
    await request(app).post("/api/v1/users/forgot-password").send({ email: student.email });
    const { passwordResetToken: token } = await prisma.user.findUnique({ where: { id: student.id } });
    const reset = await request(app)
      .post("/api/v1/users/reset-password")
      .send({ email: student.email, token, newPassword: "Newpass@1", confirmPassword: "Newpass@1" });
    expect(reset.status).toBe(200);
    expect((await me(agent)).status).toBe(401);
  });

  it("work the same way for staff", async () => {
    const staff = await createStaff();
    const deskOne = await signInStaff(staff);
    const deskTwo = await signInStaff(staff);
    expect((await deskOne.post("/api/v1/admin/refresh-token")).status).toBe(200);
    expect((await deskOne.post("/api/v1/admin/logout")).status).toBe(200);
    expect((await deskOne.get("/api/v1/admin/current-admin")).status).toBe(401);
    expect((await deskTwo.get("/api/v1/admin/current-admin")).status).toBe(200);
  });

  it("are required: an access token that names no session is refused", async () => {
    const student = await createStudent();
    const token = jwt.sign({ _id: student.id, role: "user" }, env.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
    const res = await request(app).get("/api/v1/users/current-user").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("are deleted by the cleanup job once they expire", async () => {
    const student = await createStudent();
    await signInStudent(student);
    await signInStudent(student);
    await prisma.session.updateMany({ where: { userId: student.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const live = await signInStudent(student);
    expect((await runCleanup()).sessions).toBe(2);
    expect((await me(live)).status).toBe(200);
  });
});
