import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createItem,
  createPastLoan,
  createStaff,
  createStudent,
  prisma,
  resetDatabase,
  signInStaff,
  signInStudent,
} from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { LATE_GRACE_MINUTES, LATE_RETURN_LIMIT } from "../src/config/policy.js";

beforeEach(resetDatabase);
afterAll(disconnectDB);

const lend = (desk, body) => desk.post("/api/v1/admin/lend-equipment").send({ durationMinutes: 60, ...body });

describe("reservations", () => {
  it("holds a free item for one student and shows others only that it's reserved", async () => {
    const [riya, kabir] = [await createStudent(), await createStudent()];
    const item = await createItem();
    const riyaAgent = await signInStudent(riya);
    const kabirAgent = await signInStudent(kabir);

    expect((await riyaAgent.post("/api/v1/users/reserve-equipment").send({ equipmentId: item.id })).status).toBe(200);

    const riyaView = (await riyaAgent.get("/api/v1/users/dashboard")).body.data.equipment[0];
    const kabirView = (await kabirAgent.get("/api/v1/users/dashboard")).body.data.equipment[0];
    expect(riyaView.reservation.mine).toBe(true);
    expect(kabirView.reservation.mine).toBe(false);
    expect(JSON.stringify(kabirView)).not.toContain(riya.id);

    const taken = await kabirAgent.post("/api/v1/users/reserve-equipment").send({ equipmentId: item.id });
    expect(taken.status).toBe(409);
  });

  it("allows one hold at a time", async () => {
    const student = await createStudent();
    const [a, b] = [await createItem("chess set 1", "chess"), await createItem("chess set 2", "chess")];
    const agent = await signInStudent(student);
    expect((await agent.post("/api/v1/users/reserve-equipment").send({ equipmentId: a.id })).status).toBe(200);
    const second = await agent.post("/api/v1/users/reserve-equipment").send({ equipmentId: b.id });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already holding/);
  });

  it("allows one hold even when a student reserves several items at the same time", async () => {
    const student = await createStudent();
    const items = [];
    for (let i = 1; i <= 5; i += 1) items.push(await createItem(`chess set ${i}`, "chess"));
    const agent = await signInStudent(student);
    const results = await Promise.all(items.map((item) => agent.post("/api/v1/users/reserve-equipment").send({ equipmentId: item.id })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.equipment.count({ where: { reservedById: student.id } })).toBe(1);
  });

  it("gives the item to exactly one of two students who tap at the same time", async () => {
    const item = await createItem();
    const agents = await Promise.all([createStudent(), createStudent()].map(async (p) => signInStudent(await p)));
    const results = await Promise.all(agents.map((a) => a.post("/api/v1/users/reserve-equipment").send({ equipmentId: item.id })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe("lending and returning", () => {
  it("lends with a due time, records the loan and who lent it, and marks a late return", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    const item = await createItem();
    const desk = await signInStaff(staff);

    const res = await lend(desk, { equipmentId: item.id, rollNo: student.roll_no.toLowerCase(), durationMinutes: 90 });
    expect(res.status).toBe(200);
    const loan = await prisma.loan.findFirst({ where: { equipmentId: item.id } });
    expect(loan.roll_no).toBe(student.roll_no);
    expect(loan.userId).toBe(student.id);
    expect(loan.issuedById).toBe(staff.id);
    expect(loan.dueAt.getTime() - loan.issuedAt.getTime()).toBe(90 * 60 * 1000);

    const history = await prisma.equipmentHistory.findFirst({ where: { equipmentId: item.id } });
    expect(history.changedById).toBe(staff.id);

    // Pretend it was due long ago, then take it back
    await prisma.loan.update({ where: { id: loan.id }, data: { dueAt: new Date(Date.now() - (LATE_GRACE_MINUTES + 5) * 60 * 1000) } });
    const back = await desk.post("/api/v1/admin/return-equipment").send({ equipmentId: item.id });
    expect(back.status).toBe(200);
    expect(back.body.data.late).toBe(true);
    expect((await prisma.loan.findUnique({ where: { id: loan.id } })).returnedToId).toBe(staff.id);
  });

  it("won't lend an item held for someone else, but lends it to the student holding it", async () => {
    const staff = await createStaff();
    const [holder, other] = [await createStudent(), await createStudent()];
    const item = await createItem();
    await (await signInStudent(holder)).post("/api/v1/users/reserve-equipment").send({ equipmentId: item.id });
    const desk = await signInStaff(staff);

    const wrong = await lend(desk, { equipmentId: item.id, rollNo: other.roll_no });
    expect(wrong.status).toBe(409);
    expect(wrong.body.errors[0].code).toBe("HELD_FOR_SOMEONE_ELSE");

    const right = await lend(desk, { equipmentId: item.id, rollNo: holder.roll_no });
    expect(right.status).toBe(200);
    expect((await prisma.loan.findFirst({ where: { equipmentId: item.id } })).fromReservation).toBe(true);
  });

  it("validates the lend form", async () => {
    const desk = await signInStaff(await createStaff());
    const res = await desk.post("/api/v1/admin/lend-equipment").send({ equipmentId: "x", rollNo: "!", durationMinutes: 5 });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["rollNo", "durationMinutes"]));
  });
});

describe("borrowing standing", () => {
  it(`blocks reserving and lending after ${LATE_RETURN_LIMIT} late returns, unless staff override`, async () => {
    const staff = await createStaff();
    const student = await createStudent();
    const old = await createItem("cricket bat 1", "cricket");
    const item = await createItem();
    for (let i = 0; i < LATE_RETURN_LIMIT; i += 1) {
      await createPastLoan({ item: old, student, daysAgo: i + 1, minutesLate: LATE_GRACE_MINUTES + 20 });
    }

    const agent = await signInStudent(student);
    const me = await agent.get("/api/v1/users/current-user");
    expect(me.body.data.standing.blocked).toBe(true);
    expect(me.body.data.standing.lateReturns).toBe(LATE_RETURN_LIMIT);

    const reserve = await agent.post("/api/v1/users/reserve-equipment").send({ equipmentId: item.id });
    expect(reserve.status).toBe(409);
    expect(reserve.body.errors[0].code).toBe("BORROWING_BLOCKED");

    const desk = await signInStaff(staff);
    expect((await lend(desk, { equipmentId: item.id, rollNo: student.roll_no })).status).toBe(409);
    const overridden = await lend(desk, { equipmentId: item.id, rollNo: student.roll_no, overrideBlock: true });
    expect(overridden.status).toBe(200);
    expect(overridden.body.data.overrodeBlock).toBe(true);
  });

  it("doesn't count returns inside the grace period as late", async () => {
    const student = await createStudent();
    const item = await createItem();
    for (let i = 0; i < LATE_RETURN_LIMIT; i += 1) {
      await createPastLoan({ item, student, daysAgo: i + 1, minutesLate: LATE_GRACE_MINUTES - 1 });
    }
    const me = await (await signInStudent(student)).get("/api/v1/users/current-user");
    expect(me.body.data.standing.lateReturns).toBe(0);
    expect(me.body.data.standing.blocked).toBe(false);
  });

  it("shows the desk a student's loans and standing by roll number", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    const item = await createItem();
    const desk = await signInStaff(staff);
    await lend(desk, { equipmentId: item.id, rollNo: student.roll_no });

    const summary = await desk.get(`/api/v1/admin/get-student/${student.roll_no.toLowerCase()}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.student.id).toBe(student.id);
    expect(summary.body.data.activeLoans).toHaveLength(1);
  });

  it("lists overdue loans on the desk dashboard", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    const item = await createItem();
    const desk = await signInStaff(staff);
    await lend(desk, { equipmentId: item.id, rollNo: student.roll_no });
    await prisma.loan.updateMany({ data: { dueAt: new Date(Date.now() - 30 * 60 * 1000) } });

    const dash = await desk.get("/api/v1/admin/dashboard");
    expect(dash.body.data.counts.overdue).toBe(1);
    expect(dash.body.data.overdue[0].rollNo).toBe(student.roll_no);
  });
});
