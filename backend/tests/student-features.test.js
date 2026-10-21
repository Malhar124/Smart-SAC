import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, createItem, createStaff, createStudent, prisma, request, resetDatabase, signInStaff, signInStudent } from "./helpers.js";
import { disconnectDB } from "../src/db/index.js";
import { zonedParts, zonedTimeToDate } from "../src/lib/time.js";

beforeEach(resetDatabase);
afterAll(disconnectDB);

const tomorrowAt = (hour) => {
  const t = zonedParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
  return zonedTimeToDate({ year: t.year, month: t.month, day: t.day, hour }).toISOString();
};

describe("reservations", () => {
  it("lets the holder cancel their own hold, and nobody else", async () => {
    const [holder, other] = [await createStudent(), await createStudent()];
    const item = await createItem();
    const holderAgent = await signInStudent(holder);
    await holderAgent.post("/api/v1/users/reserve-equipment").send({ equipmentId: item.id });

    expect((await (await signInStudent(other)).post("/api/v1/users/cancel-reservation").send({ equipmentId: item.id })).status).toBe(404);
    expect((await holderAgent.post("/api/v1/users/cancel-reservation").send({ equipmentId: item.id })).status).toBe(200);
    expect((await prisma.equipment.findUnique({ where: { id: item.id } })).reservedById).toBeNull();
  });
});

describe("players and games", () => {
  it("lists other confirmed students with their games", async () => {
    const me = await createStudent();
    const friend = await createStudent({ fullname: "Aarav Mehta" });
    await createStudent({ isVerified: false });
    const chess = await prisma.game.create({ data: { name: "chess" } });
    await prisma.userGameRating.create({ data: { userId: friend.id, gameId: chess.id, rating: 4 } });
    const agent = await signInStudent(me);

    const players = (await agent.get("/api/v1/users/get-all-players")).body.data;
    expect(players).toEqual([expect.objectContaining({ id: friend.id, fullname: "Aarav Mehta", games: [expect.objectContaining({ rating: 4, game: { id: chess.id, name: "chess" } })] })]);
    expect((await agent.get("/api/v1/users/get-games")).body.data.map((g) => g.name)).toEqual(["chess"]);
  });

  it("saves profile details and game ratings, checking games and phone numbers", async () => {
    const student = await createStudent();
    const taken = await createStudent();
    const chess = await prisma.game.create({ data: { name: "chess" } });
    const agent = await signInStudent(student);

    const saved = await agent
      .post("/api/v1/users/update-account-details")
      .send({ achievements: ["Inter-IIIT chess, 2nd"], games: [{ game: chess.id, rating: 5 }] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.achievements).toEqual(["Inter-IIIT chess, 2nd"]);
    expect(saved.body.data.games).toEqual([expect.objectContaining({ rating: 5, game: expect.objectContaining({ name: "chess" }) })]);

    expect((await agent.post("/api/v1/users/update-account-details").send({ games: [{ game: "missing", rating: 3 }] })).status).toBe(400);
    const phone = await agent.post("/api/v1/users/update-account-details").send({ phone_number: taken.phone_number });
    expect(phone.status).toBe(409);
    expect(phone.body.errors[0].path).toBe("phone_number");
    expect((await agent.post("/api/v1/users/update-account-details").send({})).status).toBe(400);
  });
});

describe("my bookings and tickets", () => {
  it("lists upcoming room bookings, leaving out cancelled ones", async () => {
    const room = await prisma.room.create({ data: { name: "Music Room", capacity: 10 } });
    const agent = await signInStudent(await createStudent());
    const keep = await agent.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(9), hours: 1, purpose: "Practice" });
    const drop = await agent.post("/api/v1/users/book-room").send({ roomId: room.id, startsAt: tomorrowAt(12), hours: 1 });
    await agent.post(`/api/v1/users/cancel-room-booking/${drop.body.data.id}`);

    const mine = (await agent.get("/api/v1/users/get-my-room-bookings")).body.data;
    expect(mine).toEqual([expect.objectContaining({ id: keep.body.data.id, purpose: "Practice", room: { id: room.id, name: "Music Room" } })]);
  });

  it("lists only the student's own tickets, with reply counts", async () => {
    const owner = await createStudent();
    const agent = await signInStudent(owner);
    const other = await signInStudent(await createStudent());
    const desk = await signInStaff(await createStaff());
    const mine = (await agent.post("/api/v1/users/request-new-equipment").send({ game: "chess", equipment: "clock", heading: "Mine", details: "x" })).body.data;
    await other.post("/api/v1/users/request-new-equipment").send({ game: "chess", equipment: "board", heading: "Theirs", details: "y" });
    await desk.post(`/api/v1/admin/add-ticket-comment/${mine.id}`).send({ body: "Ordered" });

    const tickets = (await agent.get("/api/v1/users/get-my-tickets")).body.data;
    expect(tickets).toEqual([expect.objectContaining({ heading: "Mine", replies: 1 })]);
  });
});

describe("verification emails", () => {
  it("send a new code only to an unconfirmed account, with the same answer for everyone", async () => {
    const confirmed = await createStudent();
    const pending = await createStudent({ isVerified: false, emailVerificationToken: "111111", emailVerificationExpires: new Date(Date.now() + 60 * 60 * 1000) });
    const ask = (email) => request(app).post("/api/v1/users/resend-verification-email").send({ email });

    const answers = await Promise.all([ask(confirmed.email), ask("nobody@iiita.ac.in"), ask(pending.email)]);
    expect(new Set(answers.map((r) => `${r.status} ${r.body.message}`)).size).toBe(1);

    // The pending account's last code went out over a minute ago (it expires in an hour of a 24-hour life)
    const after = await prisma.user.findUnique({ where: { id: pending.id } });
    expect(after.emailVerificationToken).not.toBe("111111");
    expect((await prisma.user.findUnique({ where: { id: confirmed.id } })).emailVerificationToken).toBeNull();
  });
});
