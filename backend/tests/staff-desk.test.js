import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createItem, createStaff, createStudent, prisma, resetDatabase, signInStaff, signInStudent } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { zonedParts, zonedTimeToDate } from "../src/lib/time.js";

beforeEach(resetDatabase);
afterAll(disconnectDB);

const tomorrowAt = (hour) => {
  const t = zonedParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
  return zonedTimeToDate({ year: t.year, month: t.month, day: t.day, hour }).toISOString();
};

const lend = (desk, equipmentId, rollNo) => desk.post("/api/v1/admin/lend-equipment").send({ equipmentId, rollNo, durationMinutes: 60 });

describe("games and equipment", () => {
  it("adds games and items, refusing duplicate names", async () => {
    const desk = await signInStaff(await createStaff());
    const game = await desk.post("/api/v1/admin/add-game").send({ name: "Table Tennis" });
    expect(game.status).toBe(201);
    expect(game.body.data.name).toBe("table tennis");
    expect((await desk.post("/api/v1/admin/add-game").send({ name: "table tennis" })).status).toBe(409);

    const item = await desk.post("/api/v1/admin/add-equipment").send({ gameId: game.body.data.id, name: "TT Paddle 1" });
    expect(item.status).toBe(201);
    expect(item.body.data.name).toBe("tt paddle 1");
    expect((await desk.post("/api/v1/admin/add-equipment").send({ gameId: game.body.data.id, name: "tt paddle 1" })).status).toBe(409);
    expect((await desk.post("/api/v1/admin/add-equipment").send({ gameId: "missing", name: "net" })).status).toBe(404);

    const games = (await desk.get("/api/v1/admin/get-games")).body.data;
    expect(games).toEqual([expect.objectContaining({ name: "table tennis", equipments: [expect.objectContaining({ name: "tt paddle 1", status: "available" })] })]);
  });

  it("won't remove an item or a game while something is out", async () => {
    const student = await createStudent();
    const desk = await signInStaff(await createStaff());
    const racket = await createItem("badminton racket 1", "badminton");
    const spare = await createItem("badminton racket 2", "badminton");
    await lend(desk, racket.id, student.roll_no);

    expect((await desk.post("/api/v1/admin/remove-equipment").send({ equipmentId: racket.id })).status).toBe(409);
    const game = await prisma.game.findUnique({ where: { name: "badminton" } });
    const blocked = await desk.post("/api/v1/admin/remove-game").send({ gameId: game.id });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain("badminton racket 1");

    expect((await desk.post("/api/v1/admin/remove-equipment").send({ equipmentId: spare.id })).status).toBe(200);
    await desk.post("/api/v1/admin/return-equipment").send({ equipmentId: racket.id });
    expect((await desk.post("/api/v1/admin/remove-game").send({ gameId: game.id })).status).toBe(200);
    expect(await prisma.equipment.count()).toBe(0);
    expect(await prisma.game.count()).toBe(0);
  });

  it("marks an item broken, cancelling a hold (and telling the student) or closing a loan", async () => {
    const student = await createStudent();
    const desk = await signInStaff(await createStaff());
    const held = await createItem("football 1", "football");
    const out = await createItem("football 2", "football");
    await (await signInStudent(student)).post("/api/v1/users/reserve-equipment").send({ equipmentId: held.id });
    await lend(desk, out.id, student.roll_no);

    expect((await desk.post("/api/v1/admin/set-equipment-status").send({ equipmentId: held.id, status: "broken" })).status).toBe(200);
    const heldNow = await prisma.equipment.findUnique({ where: { id: held.id } });
    expect(heldNow).toMatchObject({ status: "broken", reservedById: null });
    expect((await prisma.notification.findFirst({ where: { userId: student.id } })).title).toContain("football 1");

    expect((await desk.post("/api/v1/admin/set-equipment-status").send({ equipmentId: out.id, status: "broken" })).status).toBe(200);
    expect((await prisma.loan.findFirst({ where: { equipmentId: out.id } })).returnedAt).not.toBeNull();

    expect((await desk.post("/api/v1/admin/set-equipment-status").send({ equipmentId: out.id, status: "broken" })).status).toBe(409);
    expect((await desk.post("/api/v1/admin/set-equipment-status").send({ equipmentId: out.id, status: "available" })).status).toBe(200);
  });

  it("shows staff who holds what, and releases a hold with a note to the student", async () => {
    const student = await createStudent();
    const item = await createItem();
    const desk = await signInStaff(await createStaff());
    expect((await desk.post("/api/v1/admin/release-reservation").send({ equipmentId: item.id })).status).toBe(409);
    await (await signInStudent(student)).post("/api/v1/users/reserve-equipment").send({ equipmentId: item.id });

    const rack = (await desk.get("/api/v1/admin/get-equipment")).body.data;
    expect(rack[0].reservation).toMatchObject({ userId: student.id, name: student.fullname, rollNo: student.roll_no });

    expect((await desk.post("/api/v1/admin/release-reservation").send({ equipmentId: item.id })).status).toBe(200);
    expect((await prisma.equipment.findUnique({ where: { id: item.id } })).reservedById).toBeNull();
    expect((await prisma.notification.findFirst({ where: { userId: student.id } })).type).toBe("reservation_expired");
  });
});

describe("history", () => {
  it("records every change with the staff member, newest first, per item and overall", async () => {
    const staff = await createStaff();
    const student = await createStudent();
    const item = await createItem();
    const desk = await signInStaff(staff);
    await lend(desk, item.id, student.roll_no);
    await desk.post("/api/v1/admin/return-equipment").send({ equipmentId: item.id });

    const recent = (await desk.get("/api/v1/admin/get-recent-equipment-history")).body.data;
    expect(recent.map((h) => h.status)).toEqual(["available", "in_use"]);
    expect(recent[1]).toMatchObject({ staff: "Desk Staff", rollNo: student.roll_no, equipment: { id: item.id } });

    const overview = (await desk.get("/api/v1/admin/get-equipment-history-overview")).body.data;
    expect(overview).toEqual([expect.objectContaining({ id: item.id, total: 2 })]);

    const one = (await desk.get(`/api/v1/admin/get-equipment-history/${item.id}?page=1`)).body.data;
    expect(one).toMatchObject({ equipment: { id: item.id }, total: 2, totalPages: 1 });
    expect((await desk.get("/api/v1/admin/get-equipment-history/missing")).status).toBe(404);
  });
});

describe("rooms (staff)", () => {
  it("adds, closes and reopens a room; closed rooms can't be booked", async () => {
    const desk = await signInStaff(await createStaff());
    const agent = await signInStudent(await createStudent());
    const room = (await desk.post("/api/v1/admin/add-room").send({ name: "Music Room", capacity: 12, description: "Drums and keys" })).body.data;
    expect(room).toMatchObject({ name: "Music Room", capacity: 12, status: "available" });

    expect((await desk.post(`/api/v1/admin/update-room/${room.id}`).send({ status: "maintenance" })).status).toBe(200);
    const closed = await agent.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(10), hours: 1 });
    expect(closed.status).toBe(409);

    expect((await desk.post(`/api/v1/admin/update-room/${room.id}`).send({ status: "available", capacity: 15 })).body.data.capacity).toBe(15);
    expect((await agent.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(10), hours: 1 })).status).toBe(201);
    expect((await desk.post(`/api/v1/admin/update-room/${room.id}`).send({})).status).toBe(400);
    expect((await desk.post("/api/v1/admin/update-room/missing").send({ capacity: 3 })).status).toBe(404);
  });

  it("shows staff who booked, and removing a room cancels its bookings with a notice", async () => {
    const desk = await signInStaff(await createStaff());
    const student = await createStudent();
    const room = await prisma.room.create({ data: { name: "Drama Room", capacity: 30 } });
    await (await signInStudent(student)).post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(14), hours: 2, purpose: "Rehearsal" });

    const day = (await desk.get(`/api/v1/admin/get-rooms?date=${tomorrowAt(12).slice(0, 10)}`)).body.data;
    expect(day.rooms[0].bookings[0]).toMatchObject({ purpose: "Rehearsal", student: { id: student.id, rollNo: student.roll_no } });

    expect((await desk.post(`/api/v1/admin/remove-room/${room.id}`)).status).toBe(200);
    expect(await prisma.room.count()).toBe(0);
    expect((await prisma.notification.findFirst({ where: { userId: student.id } })).type).toBe("room_booking_cancelled");
  });

  it("closing a room cancels its upcoming bookings with a notice", async () => {
    const staff = await createStaff();
    const desk = await signInStaff(staff);
    const student = await createStudent();
    const room = await prisma.room.create({ data: { name: "Music Room", capacity: 12 } });
    await (await signInStudent(student)).post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(14), hours: 1 });

    expect((await desk.post(`/api/v1/admin/update-room/${room.id}`).send({ status: "maintenance" })).status).toBe(200);
    const booking = await prisma.roomBooking.findFirst({ where: { roomId: room.id } });
    expect(booking.cancelledAt).not.toBeNull();
    expect(booking.cancelledByAdminId).toBe(staff.id);
    expect((await prisma.notification.findFirst({ where: { userId: student.id } })).type).toBe("room_booking_cancelled");
  });
});

describe("announcements", () => {
  it("posts to confirmed students, lists with the author, and deletes", async () => {
    const desk = await signInStaff(await createStaff());
    const student = await createStudent();
    await createStudent({ isVerified: false });

    const posted = await desk.post("/api/v1/admin/make-announcement").send({ heading: "Courts closed", content: "Resurfacing on Sunday.", expiresInDays: 3 });
    expect(posted.status).toBe(201);
    expect(await prisma.notification.count()).toBe(1);
    expect((await prisma.notification.findFirst()).userId).toBe(student.id);

    const list = (await desk.get("/api/v1/admin/get-announcements")).body.data;
    expect(list.announcements[0]).toMatchObject({ heading: "Courts closed", createdBy: { name: "Desk Staff" } });

    const id = posted.body.data.id;
    expect((await desk.delete(`/api/v1/admin/delete-announcement/${id}`)).status).toBe(200);
    expect((await desk.delete(`/api/v1/admin/delete-announcement/${id}`)).status).toBe(404);
  });
});

describe("desk tools", () => {
  it("searches equipment, students, rooms and tickets", async () => {
    const desk = await signInStaff(await createStaff());
    const student = await createStudent({ fullname: "Kabir Rao" });
    await createItem("carrom board 1", "carrom");
    await prisma.room.create({ data: { name: "Carrom Corner", capacity: 4 } });
    await (await signInStudent(student)).post("/api/v1/users/request-new-equipment").send({ game: "carrom", equipment: "striker", heading: "Carrom striker", details: "Lost" });

    const res = (await desk.get("/api/v1/admin/search?q=carrom")).body.data;
    expect(res.equipment.map((e) => e.name)).toEqual(["carrom board 1"]);
    expect(res.rooms.map((r) => r.name)).toEqual(["Carrom Corner"]);
    expect(res.tickets.map((t) => t.heading)).toEqual(["Carrom striker"]);
    expect((await desk.get("/api/v1/admin/search?q=kabir")).body.data.students[0].roll_no).toBe(student.roll_no);
    expect((await desk.get("/api/v1/admin/search?q=")).status).toBe(400);
  });

  it("opens any ticket with its timeline", async () => {
    const desk = await signInStaff(await createStaff());
    const agent = await signInStudent(await createStudent());
    const ticket = (await agent.post("/api/v1/users/request-new-equipment").send({ game: "chess", equipment: "clock", heading: "Chess clock", details: "Blitz" })).body.data;
    const res = (await desk.get(`/api/v1/admin/get-ticket/${ticket.id}`)).body.data;
    expect(res).toMatchObject({ heading: "Chess clock", kind: "request", requestedItem: "clock" });
    expect(res.events.map((e) => e.type)).toEqual(["created"]);
    expect((await desk.get("/api/v1/admin/get-ticket/missing")).status).toBe(404);
  });

  it("shows busy times to staff", async () => {
    const desk = await signInStaff(await createStaff());
    const res = await desk.get("/api/v1/admin/get-usage?days=7");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ days: 7, enoughData: false });
  });
});
