import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createStudent, prisma, resetDatabase, signInStudent } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { runCleanup } from "../src/jobs/index.js";
import { DAY, MESSAGES_PAGE_SIZE, NOTIFICATION_RETENTION_DAYS } from "../src/config/policy.js";

beforeEach(resetDatabase);
afterAll(disconnectDB);

/** `count` messages between a and b, alternating, one second apart, oldest first */
const seedConversation = async (a, b, count) => {
  const start = Date.now() - count * 1000;
  await prisma.message.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      senderId: i % 2 ? b.id : a.id,
      receiverId: i % 2 ? a.id : b.id,
      content: `message ${i + 1}`,
      status: "sent",
      createdAt: new Date(start + i * 1000),
    })),
  });
};

describe("chat", () => {
  it("limits how many messages a student can send in a minute", async () => {
    const [me, them] = [await createStudent(), await createStudent()];
    const agent = await signInStudent(me);
    const send = (content) => agent.post("/api/v1/users/send-message").send({ receiverId: them.id, content });
    for (let i = 0; i < 30; i += 1) expect((await send(`hi ${i}`)).status).toBe(201);
    expect((await send("one more")).status).toBe(429);
  });

  it("loads the latest page first and older pages on request, in time order", async () => {
    const [a, b] = [await createStudent(), await createStudent()];
    const total = MESSAGES_PAGE_SIZE + 15;
    await seedConversation(a, b, total);
    const agent = await signInStudent(a);

    const latest = (await agent.get(`/api/v1/users/get-messages/${b.id}`)).body.data;
    expect(latest.messages).toHaveLength(MESSAGES_PAGE_SIZE);
    expect(latest.hasMore).toBe(true);
    expect(latest.messages.at(-1).content).toBe(`message ${total}`);
    expect(latest.messages[0].content).toBe(`message ${total - MESSAGES_PAGE_SIZE + 1}`);

    const older = (await agent.get(`/api/v1/users/get-messages/${b.id}?before=${latest.messages[0].id}`)).body.data;
    expect(older.messages.map((m) => m.content)).toEqual(Array.from({ length: 15 }, (_, i) => `message ${i + 1}`));
    expect(older.hasMore).toBe(false);
  });

  it("takes a page size and validates it", async () => {
    const [a, b] = [await createStudent(), await createStudent()];
    await seedConversation(a, b, 5);
    const agent = await signInStudent(a);
    const page = (await agent.get(`/api/v1/users/get-messages/${b.id}?limit=2`)).body.data;
    expect(page.messages.map((m) => m.content)).toEqual(["message 4", "message 5"]);
    expect((await agent.get(`/api/v1/users/get-messages/${b.id}?limit=500`)).status).toBe(400);
  });

  it("won't let a student message themselves or someone who doesn't exist", async () => {
    const student = await createStudent();
    const agent = await signInStudent(student);
    expect((await agent.post("/api/v1/users/send-message").send({ receiverId: student.id, content: "hi" })).status).toBe(400);
    expect((await agent.post("/api/v1/users/send-message").send({ receiverId: "nobody", content: "hi" })).status).toBe(404);
  });
});

describe("notifications", () => {
  const note = (userId, title, extra = {}) => ({ userId, type: "announcement", title, body: "Body", ...extra });

  it("lists a student's own notifications, newest first, with the unread count", async () => {
    const [student, other] = [await createStudent(), await createStudent()];
    await prisma.notification.createMany({
      data: [note(student.id, "Old", { createdAt: new Date(Date.now() - 60_000) }), note(student.id, "New"), note(other.id, "Not yours")],
    });
    const res = await (await signInStudent(student)).get("/api/v1/users/get-notifications");
    expect(res.status).toBe(200);
    expect(res.body.data.notifications.map((n) => n.title)).toEqual(["New", "Old"]);
    expect(res.body.data.unread).toBe(2);
  });

  it("marks some or all as read, and never another student's", async () => {
    const [student, other] = [await createStudent(), await createStudent()];
    await prisma.notification.createMany({ data: [note(student.id, "A"), note(student.id, "B"), note(other.id, "C")] });
    const [a, , c] = await prisma.notification.findMany({ orderBy: { title: "asc" } });
    const agent = await signInStudent(student);

    const some = await agent.post("/api/v1/users/mark-notifications-read").send({ ids: [a.id, c.id] });
    expect(some.body.data.marked).toBe(1);
    expect((await prisma.notification.findUnique({ where: { id: c.id } })).readAt).toBeNull();

    const all = await agent.post("/api/v1/users/mark-notifications-read").send({});
    expect(all.body.data.marked).toBe(1);
    expect(await prisma.notification.count({ where: { userId: student.id, readAt: null } })).toBe(0);
  });

  it(`are deleted after ${NOTIFICATION_RETENTION_DAYS} days`, async () => {
    const student = await createStudent();
    await prisma.notification.createMany({
      data: [note(student.id, "Ancient", { createdAt: new Date(Date.now() - (NOTIFICATION_RETENTION_DAYS + 1) * DAY) }), note(student.id, "Recent")],
    });
    expect((await runCleanup()).notifications).toBe(1);
    expect((await prisma.notification.findMany()).map((n) => n.title)).toEqual(["Recent"]);
  });
});
