import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, createStudent, prisma, request, resetDatabase, signInStudent } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { runCleanup } from "../src/jobs/index.js";
import { MAX_CODE_ATTEMPTS } from "../src/config/policy.js";

beforeEach(resetDatabase);
afterAll(disconnectDB);

const registration = {
  fullname: "Riya Sharma",
  username: "riya",
  email: "iit2023001@iiita.ac.in",
  phone_number: "9876543210",
  roll_no: "IIT2023001",
  password: "Strong@123",
};

const register = (overrides = {}) => request(app).post("/api/v1/users/register").send({ ...registration, ...overrides });

/** Any 6-digit code that isn't `code` */
const wrongCode = (code) => String((Number(code) % 899999) + 100001);

describe("roll numbers", () => {
  it("must match a student email at sign-up", async () => {
    const res = await register({ roll_no: "IIT2023002" });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([expect.objectContaining({ path: "roll_no", message: expect.stringContaining("IIT2023001") })]);
  });

  it("come only from a roll-number email, so nobody can sign up as another student", async () => {
    const res = await register({ email: "riya.sharma@iiita.ac.in", roll_no: "IIT2023001" });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([expect.objectContaining({ path: "email" })]);
  });

  it("belongs to one account", async () => {
    await createStudent({ roll_no: "IIT2023001", email: "someone@iiita.ac.in" });
    const res = await register();
    expect(res.status).toBe(409);
    expect(res.body.errors[0].path).toBe("roll_no");
  });

  it("can't be changed from the profile, so a blocked student can't dodge their record", async () => {
    const student = await createStudent();
    const agent = await signInStudent(student);
    const res = await agent.post("/api/v1/users/update-account-details").send({ fullname: "New Name", roll_no: "IIT2099999" });
    expect(res.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: student.id } });
    expect(after.fullname).toBe("New Name");
    expect(after.roll_no).toBe(student.roll_no);
  });
});

describe("unconfirmed sign-ups", () => {
  it("don't hold an email: signing up again replaces the pending account and its code", async () => {
    expect((await register({ username: "impostor", phone_number: "9000000001" })).status).toBe(201);
    const first = await prisma.user.findUnique({ where: { email: registration.email } });

    expect((await register()).status).toBe(201);
    const second = await prisma.user.findUnique({ where: { email: registration.email } });
    expect(await prisma.user.count()).toBe(1);
    expect(second.id).not.toBe(first.id);
    expect(second.username).toBe("riya");
  });

  it("don't hold a phone number, username or roll number either", async () => {
    // Someone signs up with Riya's phone and username under another address and never confirms
    expect((await register({ email: "iit2023999@iiita.ac.in", roll_no: "IIT2023999" })).status).toBe(201);
    const res = await register();
    expect(res.status).toBe(201);
    expect(await prisma.user.findUnique({ where: { email: "iit2023999@iiita.ac.in" } })).toBeNull();
  });

  it("still lose to a confirmed account", async () => {
    await createStudent({ phone_number: registration.phone_number });
    const res = await register();
    expect(res.status).toBe(409);
    expect(res.body.errors[0].path).toBe("phone_number");
  });

  it("are deleted once their code expires", async () => {
    await register();
    await prisma.user.update({ where: { email: registration.email }, data: { emailVerificationExpires: new Date(Date.now() - 1000) } });
    const confirmed = await createStudent();
    const result = await runCleanup();
    expect(result.unconfirmedAccounts).toBe(1);
    expect(await prisma.user.findMany({ select: { id: true } })).toEqual([{ id: confirmed.id }]);
  });
});

describe("email codes", () => {
  it(`cancel the verification code after ${MAX_CODE_ATTEMPTS} wrong guesses`, async () => {
    await register();
    const { emailVerificationToken: code } = await prisma.user.findUnique({ where: { email: registration.email } });
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) {
      const res = await request(app).post("/api/v1/users/verify-email").send({ email: registration.email, token: wrongCode(code) });
      expect(res.status).toBe(400);
    }
    const right = await request(app).post("/api/v1/users/verify-email").send({ email: registration.email, token: code });
    expect(right.status).toBe(400);
  });

  it("count guesses sent all at once", async () => {
    const student = await createStudent();
    await request(app).post("/api/v1/users/forgot-password").send({ email: student.email });
    const { passwordResetToken: code } = await prisma.user.findUnique({ where: { id: student.id } });
    await Promise.all(
      Array.from({ length: MAX_CODE_ATTEMPTS + 3 }, () =>
        request(app).post("/api/v1/users/verify-reset-token").send({ email: student.email, token: wrongCode(code) })
      )
    );
    expect((await prisma.user.findUnique({ where: { id: student.id } })).passwordResetAttempts).toBe(MAX_CODE_ATTEMPTS);
    const right = await request(app).post("/api/v1/users/verify-reset-token").send({ email: student.email, token: code });
    expect(right.status).toBe(400);
  });

  it("work again with a fresh code, and the attempt count starts over", async () => {
    const student = await createStudent();
    await request(app).post("/api/v1/users/forgot-password").send({ email: student.email });
    const first = await prisma.user.findUnique({ where: { id: student.id } });
    await request(app).post("/api/v1/users/verify-reset-token").send({ email: student.email, token: wrongCode(first.passwordResetToken) });

    // Pretend the first code went out two minutes ago, past the resend wait
    await prisma.user.update({ where: { id: student.id }, data: { passwordResetExpires: new Date(first.passwordResetExpires.getTime() - 2 * 60 * 1000) } });
    await request(app).post("/api/v1/users/forgot-password").send({ email: student.email });
    const second = await prisma.user.findUnique({ where: { id: student.id } });
    expect(second.passwordResetAttempts).toBe(0);
    const ok = await request(app).post("/api/v1/users/verify-reset-token").send({ email: student.email, token: second.passwordResetToken });
    expect(ok.status).toBe(200);
  });

  it("aren't resent more than once a minute", async () => {
    const student = await createStudent();
    await request(app).post("/api/v1/users/forgot-password").send({ email: student.email });
    const first = await prisma.user.findUnique({ where: { id: student.id } });
    const again = await request(app).post("/api/v1/users/forgot-password").send({ email: student.email });
    expect(again.status).toBe(200);
    const second = await prisma.user.findUnique({ where: { id: student.id } });
    expect(second.passwordResetToken).toBe(first.passwordResetToken);
    expect(second.passwordResetExpires).toEqual(first.passwordResetExpires);
  });
});
