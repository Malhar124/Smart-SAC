import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, createItem, createStudent, prisma, request, resetDatabase, signInStudent } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { runReminders } from "../src/jobs/index.js";
import { getUsage, MIN_LOANS_FOR_CHART } from "../src/services/usage.service.js";
import { openApiDocument } from "../src/app.js";
import { zonedParts, zonedTimeToDate } from "../src/lib/time.js";

beforeEach(resetDatabase);
afterAll(disconnectDB);

const minutes = (n) => n * 60 * 1000;

describe("reminder jobs", () => {
  it("reminds about an expiring hold once, then clears it when it runs out", async () => {
    const student = await createStudent();
    const item = await createItem();
    const now = new Date();
    await prisma.equipment.update({ where: { id: item.id }, data: { reservedById: student.id, reservedUntil: new Date(now.getTime() + minutes(3)) } });

    expect((await runReminders(now)).holdsReminded).toBe(1);
    expect((await runReminders(now)).holdsReminded).toBe(0);

    const later = new Date(now.getTime() + minutes(4));
    expect((await runReminders(later)).holdsCleared).toBe(1);
    expect((await prisma.equipment.findUnique({ where: { id: item.id } })).reservedById).toBeNull();

    const types = (await prisma.notification.findMany({ where: { userId: student.id }, orderBy: { createdAt: "asc" } })).map((n) => n.type);
    expect(types).toEqual(["reservation_expiring", "reservation_expired"]);
  });

  it("sends due-soon and overdue notices exactly once per loan", async () => {
    const student = await createStudent();
    const item = await createItem();
    const now = new Date();
    const loan = await prisma.loan.create({
      data: { equipmentId: item.id, userId: student.id, roll_no: student.roll_no, issuedAt: new Date(now.getTime() - minutes(50)), dueAt: new Date(now.getTime() + minutes(10)) },
    });

    expect((await runReminders(now)).dueSoon).toBe(1);
    const afterDue = new Date(loan.dueAt.getTime() + minutes(1));
    expect((await runReminders(afterDue)).overdue).toBe(1);
    expect((await runReminders(afterDue)).overdue).toBe(0);
    expect(await prisma.notification.count({ where: { userId: student.id } })).toBe(2);
  });
});

describe("busy times", () => {
  it("averages items out per local hour from real loans", async () => {
    const student = await createStudent();
    const item = await createItem();
    const days = 7;
    // Six days back (all inside the 7-day window whatever the time of day): one loan at 18:00 SAC time,
    // three on odd days -> 3 + 1 + 3 + 1 + 3 + 1 = 12 loans
    for (let d = 1; d <= 6; d += 1) {
      const day = zonedParts(new Date(Date.now() - d * 24 * 60 * 60 * 1000));
      const issuedAt = zonedTimeToDate({ year: day.year, month: day.month, day: day.day, hour: 18 });
      for (let n = 0; n < (d % 2 ? 3 : 1); n += 1) {
        await prisma.loan.create({
          data: { equipmentId: item.id, userId: student.id, roll_no: student.roll_no, issuedAt, dueAt: new Date(issuedAt.getTime() + minutes(60)), returnedAt: new Date(issuedAt.getTime() + minutes(45)) },
        });
      }
    }

    const usage = await getUsage({ days, gameId: undefined });
    expect(usage.totalLoans).toBe(12);
    expect(usage.enoughData).toBe(true);
    expect(usage.busiestHour).toBe(18);
    expect(usage.hours.find((h) => h.hour === 18).averageOut).toBeCloseTo(12 / 7, 1);
    expect(usage.typicalLoanMinutes).toBe(45);
  });

  it(`says there isn't enough data below ${MIN_LOANS_FOR_CHART} checkouts`, async () => {
    const usage = await getUsage({ days: 28 });
    expect(usage.enoughData).toBe(false);
    expect(usage.busiestHour).toBeNull();
  });

  it("is available to students through the API", async () => {
    const agent = await signInStudent(await createStudent());
    const res = await agent.get("/api/v1/users/get-usage?days=14");
    expect(res.status).toBe(200);
    expect(res.body.data.days).toBe(14);
    expect((await agent.get("/api/v1/users/get-usage?days=3")).status).toBe(400);
  });
});

describe("API contract", () => {
  it("documents every route it serves", () => {
    const ops = Object.values(openApiDocument.paths).reduce((n, methods) => n + Object.keys(methods).length, 0);
    expect(ops).toBeGreaterThanOrEqual(65);
    expect(openApiDocument.paths["/admin/lend-equipment"].post.requestBody).toBeDefined();
    expect(openApiDocument.paths["/users/get-messages/{otherUserId}"]).toBeDefined();
  });

  it("serves the docs, a health check and JSON errors", async () => {
    expect((await request(app).get("/api/openapi.json")).body.info.title).toBe("Smart SAC API");
    expect((await request(app).get("/api/health")).body.database).toBe("ok");
    const missing = await request(app).get("/api/v1/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.success).toBe(false);
    const badJson = await request(app).post("/api/v1/users/login").set("Content-Type", "application/json").send("{oops");
    expect(badJson.status).toBe(400);
  });

  it("serves public announcements without signing in", async () => {
    await prisma.announcement.create({ data: { heading: "Hello", content: "World", expireAt: new Date(Date.now() + minutes(60)) } });
    const res = await request(app).get("/api/v1/users/get-announcements");
    expect(res.status).toBe(200);
    expect(res.body.data.announcements[0].heading).toBe("Hello");
  });

  it("counts unread chat messages and clears them when the conversation is opened", async () => {
    const [a, b] = [await createStudent(), await createStudent()];
    const agentA = await signInStudent(a);
    const agentB = await signInStudent(b);
    await agentA.post("/api/v1/users/send-message").send({ receiverId: b.id, content: "Badminton at 6?" });

    expect((await agentB.get("/api/v1/users/dashboard")).body.data.unreadMessages).toBe(1);
    expect((await agentB.get("/api/v1/users/get-conversations")).body.data[0].unreadCount).toBe(1);
    await agentB.get(`/api/v1/users/get-messages/${a.id}`);
    expect((await agentB.get("/api/v1/users/dashboard")).body.data.unreadMessages).toBe(0);
  });
});
