import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, createStaff, createStudent, prisma, request, resetDatabase, signInStudent, PASSWORD } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";

const registration = {
  fullname: "Riya Sharma",
  username: "riya",
  email: "iit2023001@iiita.ac.in",
  phone_number: "9876543210",
  roll_no: "iit2023001",
  password: "Strong@123",
};

beforeEach(resetDatabase);
afterAll(disconnectDB);

describe("student sign-up", () => {
  it("creates an unverified account, refuses sign-in until the email is confirmed, then signs in", async () => {
    const created = await request(app).post("/api/v1/users/register").send(registration);
    expect(created.status).toBe(201);
    expect(created.body.data.user.roll_no).toBe("IIT2023001");
    expect(created.body.data.emailDelivered).toBe(false);

    const early = await request(app).post("/api/v1/users/login").send({ email: registration.email, password: registration.password });
    expect(early.status).toBe(403);
    expect(early.body.errors[0].code).toBe("EMAIL_NOT_VERIFIED");

    const { emailVerificationToken } = await prisma.user.findUnique({ where: { email: registration.email } });
    const verified = await request(app)
      .post("/api/v1/users/verify-email")
      .send({ email: registration.email, token: emailVerificationToken });
    expect(verified.status).toBe(200);

    const agent = request.agent(app);
    const login = await agent.post("/api/v1/users/login").send({ email: "riya", password: registration.password });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"].join(";")).toContain("accessToken=");

    const me = await agent.get("/api/v1/users/current-user");
    expect(me.status).toBe(200);
    expect(me.body.data.userDetails.email).toBe(registration.email);
    expect(me.body.data.userDetails).not.toHaveProperty("password");
  });

  it("explains every invalid field", async () => {
    const res = await request(app)
      .post("/api/v1/users/register")
      .send({ ...registration, email: "riya@gmail.com", phone_number: "123", password: "weak" });
    expect(res.status).toBe(400);
    const paths = res.body.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["email", "phone_number", "password"]));
    expect(res.body.errors.find((e) => e.path === "email").message).toMatch(/@iiita\.ac\.in/);
  });

  it("rejects a duplicate email with 409", async () => {
    await createStudent({ email: registration.email, roll_no: "IIT2023001" });
    const res = await request(app).post("/api/v1/users/register").send(registration);
    expect(res.status).toBe(409);
  });

  it("uses one message for an unknown account and a wrong password", async () => {
    const student = await createStudent();
    const wrong = await request(app).post("/api/v1/users/login").send({ email: student.email, password: "Wrong@123" });
    const unknown = await request(app).post("/api/v1/users/login").send({ email: "nobody@iiita.ac.in", password: "Wrong@123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });
});

describe("sessions", () => {
  it("rotates the refresh token and rejects the old one", async () => {
    const student = await createStudent();
    const agent = await signInStudent(student);
    const before = (await prisma.user.findUnique({ where: { id: student.id } })).refreshToken;

    // Tokens issued in the same second are identical, so wait for a new iat
    await new Promise((r) => setTimeout(r, 1100));
    const refreshed = await agent.post("/api/v1/users/refresh-token");
    expect(refreshed.status).toBe(200);

    const after = (await prisma.user.findUnique({ where: { id: student.id } })).refreshToken;
    expect(after).not.toBe(before);

    const replay = await request(app).post("/api/v1/users/refresh-token").send({ refreshToken: before });
    expect(replay.status).toBe(401);
  });

  it("revokes the session on sign-out", async () => {
    const student = await createStudent();
    const agent = await signInStudent(student);
    expect((await agent.post("/api/v1/users/logout")).status).toBe(200);
    expect((await agent.post("/api/v1/users/refresh-token")).status).toBe(401);
  });

  it("keeps student and staff tokens apart", async () => {
    const student = await createStudent();
    const agent = await signInStudent(student);
    expect((await agent.get("/api/v1/admin/dashboard")).status).toBe(401);
  });
});

describe("passwords", () => {
  it("resets a forgotten password with email + code, then signs in with the new one", async () => {
    const student = await createStudent();
    expect((await request(app).post("/api/v1/users/forgot-password").send({ email: student.email })).status).toBe(200);
    const { passwordResetToken } = await prisma.user.findUnique({ where: { id: student.id } });

    const wrongEmail = await request(app)
      .post("/api/v1/users/verify-reset-token")
      .send({ email: "other@iiita.ac.in", token: passwordResetToken });
    expect(wrongEmail.status).toBe(400);

    const check = await request(app).post("/api/v1/users/verify-reset-token").send({ email: student.email, token: passwordResetToken });
    expect(check.status).toBe(200);

    const reset = await request(app)
      .post("/api/v1/users/reset-password")
      .send({ email: student.email, token: passwordResetToken, newPassword: "Newpass@1", confirmPassword: "Newpass@1" });
    expect(reset.status).toBe(200);

    const login = await request(app).post("/api/v1/users/login").send({ email: student.email, password: "Newpass@1" });
    expect(login.status).toBe(200);
  });

  it("changes the password when the current one is right", async () => {
    const student = await createStudent();
    const agent = await signInStudent(student);
    const wrong = await agent.post("/api/v1/users/change-password").send({ oldPassword: "Nope@1234", newPassword: "Another@1" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.errors[0].path).toBe("oldPassword");
    const right = await agent.post("/api/v1/users/change-password").send({ oldPassword: PASSWORD, newPassword: "Another@1" });
    expect(right.status).toBe(200);
  });
});

describe("staff accounts", () => {
  it("only lets emails on the staff list register", async () => {
    const outsider = await request(app)
      .post("/api/v1/admin/register")
      .send({ name: "Someone", email: "someone@iiita.ac.in", password: "Strong@123" });
    expect(outsider.status).toBe(403);

    const listed = await request(app)
      .post("/api/v1/admin/register")
      .send({ name: "Desk Staff", email: "desk@iiita.ac.in", password: "Strong@123" });
    expect(listed.status).toBe(201);
    expect(listed.body.data.name).toBe("Desk Staff");
  });

  it("signs staff in", async () => {
    const staff = await createStaff();
    const res = await request(app).post("/api/v1/admin/login").send({ email: staff.email, password: PASSWORD });
    expect(res.status).toBe(200);
  });
});
