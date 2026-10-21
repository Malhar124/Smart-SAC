import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/index.js";
import { hashPassword } from "../src/utils/auth.js";

export const PASSWORD = "Test@1234";

const TABLES = [
  "Notification",
  "TicketEvent",
  "Ticket",
  "RoomBooking",
  "Room",
  "Loan",
  "EquipmentHistory",
  "Message",
  "UserGameRating",
  "_EquipmentToGame",
  "Equipment",
  "Game",
  "Announcement",
  "User",
  "Admin",
];

export const resetDatabase = async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
};

let counter = 0;
const hashed = hashPassword(PASSWORD);

export const createStudent = async (overrides = {}) => {
  counter += 1;
  const roll = overrides.roll_no ?? `IIT2099${String(counter).padStart(3, "0")}`;
  return prisma.user.create({
    data: {
      fullname: `Student ${counter}`,
      username: `student${counter}`,
      email: `${roll.toLowerCase()}@iiita.ac.in`,
      roll_no: roll,
      phone_number: `90000${String(counter).padStart(5, "0")}`,
      password: await hashed,
      isVerified: true,
      ...overrides,
    },
  });
};

export const createStaff = async (overrides = {}) =>
  prisma.admin.create({ data: { email: "desk@iiita.ac.in", name: "Desk Staff", password: await hashed, ...overrides } });

export const createItem = async (name = "badminton racket 1", gameName = "badminton") => {
  const game = await prisma.game.upsert({ where: { name: gameName }, update: {}, create: { name: gameName } });
  return prisma.equipment.create({ data: { name, games: { connect: { id: game.id } } } });
};

/** A supertest agent that keeps the session cookies of a signed-in student */
export const signInStudent = async (student) => {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/users/login").send({ email: student.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`student login failed: ${res.status} ${res.body.message}`);
  return agent;
};

export const signInStaff = async (staff) => {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/admin/login").send({ email: staff.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`staff login failed: ${res.status} ${res.body.message}`);
  return agent;
};

/** A finished loan for standing calculations; minutesLate > grace makes it count as late */
export const createPastLoan = async ({ item, student, daysAgo = 1, minutesLate = 0 }) => {
  const issuedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const dueAt = new Date(issuedAt.getTime() + 60 * 60 * 1000);
  return prisma.loan.create({
    data: {
      equipmentId: item.id,
      userId: student.id,
      roll_no: student.roll_no,
      issuedAt,
      dueAt,
      returnedAt: new Date(dueAt.getTime() + minutesLate * 60 * 1000),
    },
  });
};

export { app, prisma, request };
