import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createItem, createStaff, createStudent, prisma, resetDatabase, signInStaff, signInStudent } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { zonedParts, zonedTimeToDate } from "../src/lib/time.js";
import { bookRoom } from "../src/services/rooms.service.js";
import { DAY, MINUTE, ROOM_MAX_UPCOMING_BOOKINGS } from "../src/config/policy.js";

beforeEach(resetDatabase);
afterAll(disconnectDB);

/** Tomorrow at `hour`, SAC time, as an ISO string */
const tomorrowAt = (hour) => {
  const t = zonedParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
  return zonedTimeToDate({ year: t.year, month: t.month, day: t.day, hour }).toISOString();
};

describe("rooms", () => {
  it("books a slot, blocks overlaps, and lets the student cancel", async () => {
    const room = await prisma.room.create({ data: { name: "Music Room", capacity: 10 } });
    const riya = await signInStudent(await createStudent());
    const kabir = await signInStudent(await createStudent());

    const booked = await riya.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(17), hours: 2 });
    expect(booked.status).toBe(201);

    const clash = await kabir.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(18), hours: 1 });
    expect(clash.status).toBe(409);

    const day = await kabir.get(`/api/v1/users/get-rooms?date=${tomorrowAt(12).slice(0, 10)}`);
    const booking = day.body.data.rooms[0].bookings[0];
    expect(booking.mine).toBe(false);
    expect(booking).not.toHaveProperty("student");

    const cancelled = await riya.post(`/api/v1/users/cancel-room-booking/${booked.body.data.id}`);
    expect(cancelled.status).toBe(200);
    expect((await kabir.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(18), hours: 1 })).status).toBe(201);
  });

  it("only books whole hours inside opening hours", async () => {
    const room = await prisma.room.create({ data: { name: "Art Room", capacity: 10 } });
    const agent = await signInStudent(await createStudent());
    const late = await agent.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(21), hours: 2 });
    expect(late.status).toBe(400);
    const offHour = new Date(new Date(tomorrowAt(15)).getTime() + 30 * 60 * 1000).toISOString();
    expect((await agent.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: offHour, hours: 1 })).status).toBe(400);
  });

  it(`limits a student to ${ROOM_MAX_UPCOMING_BOOKINGS} upcoming bookings`, async () => {
    const room = await prisma.room.create({ data: { name: "Dance Studio", capacity: 10 } });
    const agent = await signInStudent(await createStudent());
    for (let i = 0; i < ROOM_MAX_UPCOMING_BOOKINGS; i += 1) {
      expect((await agent.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(8 + i * 2), hours: 1 })).status).toBe(201);
    }
    expect((await agent.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(15), hours: 1 })).status).toBe(409);
  });

  it("books the slot that's under way, even after half past the hour", async () => {
    // At 10:45 SAC time the 10:00 slot is still running. India is UTC+5:30, so rounding "this hour"
    // down in UTC gave 10:30 and refused it.
    const room = await prisma.room.create({ data: { name: "Band Room", capacity: 8 } });
    const student = await createStudent();
    const t = zonedParts(new Date(Date.now() + DAY));
    const tenAm = zonedTimeToDate({ year: t.year, month: t.month, day: t.day, hour: 10 });
    const now = new Date(tenAm.getTime() + 45 * MINUTE);

    const booking = await bookRoom({ userId: student.id, roomId: room.id, startsAt: tenAm.toISOString(), hours: 1, now });
    expect(booking.startsAt).toEqual(tenAm);
    const nineAm = new Date(tenAm.getTime() - 60 * MINUTE).toISOString();
    await expect(bookRoom({ userId: student.id, roomId: room.id, startsAt: nineAm, hours: 1, now })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("won't let one student book two rooms at the same time by sending both requests together", async () => {
    const rooms = await Promise.all(["Room A", "Room B"].map((name) => prisma.room.create({ data: { name, capacity: 5 } })));
    const agent = await signInStudent(await createStudent());
    const results = await Promise.all(rooms.map((room) => agent.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(16), hours: 1 })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("notifies the student when staff cancel their booking", async () => {
    const room = await prisma.room.create({ data: { name: "Drama Room", capacity: 30 } });
    const student = await createStudent();
    const booking = await (await signInStudent(student)).post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(10), hours: 1 });
    const desk = await signInStaff(await createStaff());

    const res = await desk.post(`/api/v1/admin/cancel-room-booking/${booking.body.data.id}`).send({ reason: "Floor cleaning" });
    expect(res.status).toBe(200);
    const note = await prisma.notification.findFirst({ where: { userId: student.id } });
    expect(note.type).toBe("room_booking_cancelled");
    expect(note.body).toContain("Floor cleaning");
  });
});

describe("tickets", () => {
  it("keeps a timeline of status changes and replies, and notifies the student", async () => {
    const student = await createStudent();
    const item = await createItem();
    const agent = await signInStudent(student);
    const desk = await signInStaff(await createStaff());

    const created = await agent.post("/api/v1/users/create-ticket").send({ equipmentId: item.id, heading: "Grip is torn", content: "Racket 1 grip tape is coming off." });
    expect(created.status).toBe(201);
    const ticketId = created.body.data.id;

    expect((await desk.post("/api/v1/admin/update-ticket").send({ ticketId, newStatus: "in_process", note: "Regripping today" })).status).toBe(200);
    expect((await desk.post(`/api/v1/admin/add-ticket-comment/${ticketId}`).send({ body: "Done, it's back on the rack." })).status).toBe(201);
    expect((await agent.post(`/api/v1/users/add-ticket-comment/${ticketId}`).send({ body: "Thanks!" })).status).toBe(201);

    const ticket = (await agent.get(`/api/v1/users/get-ticket/${ticketId}`)).body.data;
    expect(ticket.status).toBe("in_process");
    expect(ticket.events.map((e) => e.type)).toEqual(["created", "status_changed", "comment", "comment"]);
    expect(ticket.events[1].author).toEqual({ kind: "staff", name: "Desk Staff" });

    const notes = await prisma.notification.findMany({ where: { userId: student.id }, orderBy: { createdAt: "asc" } });
    expect(notes.map((n) => n.type)).toEqual(["ticket_updated", "ticket_reply"]);
  });

  it("won't take replies on a closed ticket", async () => {
    const student = await createStudent();
    const agent = await signInStudent(student);
    const desk = await signInStaff(await createStaff());
    const created = await agent.post("/api/v1/users/request-new-equipment").send({ game: "carrom", equipment: "striker", heading: "Need a striker", details: "Board 2 has none." });
    await desk.post("/api/v1/admin/update-ticket").send({ ticketId: created.body.data.id, newStatus: "closed" });
    const reply = await agent.post(`/api/v1/users/add-ticket-comment/${created.body.data.id}`).send({ body: "Still missing" });
    expect(reply.status).toBe(409);
  });

  it("hides other students' tickets", async () => {
    const owner = await signInStudent(await createStudent());
    const other = await signInStudent(await createStudent());
    const created = await owner.post("/api/v1/users/request-new-equipment").send({ game: "chess", equipment: "clock", heading: "Chess clock", details: "For blitz." });
    expect((await other.get(`/api/v1/users/get-ticket/${created.body.data.id}`)).status).toBe(404);
  });

  it("filters staff tickets by status with counts", async () => {
    const agent = await signInStudent(await createStudent());
    const desk = await signInStaff(await createStaff());
    const a = await agent.post("/api/v1/users/request-new-equipment").send({ game: "chess", equipment: "clock", heading: "A", details: "x" });
    await agent.post("/api/v1/users/request-new-equipment").send({ game: "chess", equipment: "board", heading: "B", details: "y" });
    await desk.post("/api/v1/admin/update-ticket").send({ ticketId: a.body.data.id, newStatus: "closed" });

    const closed = await desk.get("/api/v1/admin/get-tickets?status=closed");
    expect(closed.body.data.tickets.map((t) => t.heading)).toEqual(["A"]);
    expect(closed.body.data.counts).toMatchObject({ all: 2, open: 1, closed: 1 });
  });
});
