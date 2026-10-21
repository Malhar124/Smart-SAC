// Demo data for local development and screenshots: `npm run seed` (add `-- --yes` to replace existing data).
// Everything is generated from a fixed random seed, so two runs produce the same SAC.
import "dotenv/config";
import { env } from "./config/env.js";
import { prisma, disconnectDB } from "./db/index.js";
import { hashPassword } from "./utils/auth.js";
import { zonedParts, zonedTimeToDate } from "./lib/time.js";
import { DAY, HISTORY_RETENTION_DAYS, HOUR, LATE_GRACE_MINUTES, MINUTE } from "./config/policy.js";

export const DEMO_PASSWORD = "Demo@1234";
export const DEMO_STAFF = { email: "desk@iiita.ac.in", name: "Ravi Kumar" };
export const DEMO_STUDENT_EMAIL = "iit2023001@iiita.ac.in";

// ---------------------------------------------------------------- deterministic randomness

let state = 20261010;
const random = () => {
  // mulberry32
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

// ---------------------------------------------------------------- catalogue

const GAMES = {
  badminton: ["badminton racket 1", "badminton racket 2", "badminton racket 3", "badminton racket 4", "shuttlecock tube 1", "shuttlecock tube 2"],
  "table tennis": ["table tennis bat 1", "table tennis bat 2", "table tennis bat 3", "table tennis bat 4", "table tennis balls"],
  chess: ["chess set 1", "chess set 2", "chess set 3"],
  carrom: ["carrom board 1", "carrom board 2"],
  cricket: ["cricket bat 1", "cricket bat 2", "cricket ball 1", "cricket ball 2"],
  football: ["football 1", "football 2"],
  volleyball: ["volleyball 1", "volleyball 2"],
  basketball: ["basketball 1", "basketball 2"],
  "lawn tennis": ["lawn tennis racket 1", "lawn tennis racket 2"],
  snooker: ["snooker cue 1", "snooker cue 2", "snooker cue 3"],
};

const ROOMS = [
  { name: "Music Room", capacity: 15, description: "Keyboard, two guitars and a drum kit. Bring your own headphones." },
  { name: "Drama Room", capacity: 30, description: "Open floor with mirrors and a small stage." },
  { name: "Dance Studio", capacity: 25, description: "Sprung floor, speakers with aux input." },
  { name: "Art Room", capacity: 20, description: "Easels and tables. Clean up paint before you leave." },
  { name: "TT Room", capacity: 8, description: "Two table tennis tables." },
  { name: "Quiet Room", capacity: 12, description: "For chess, carrom and board games." },
];

const FIRST = ["Riya", "Aarav", "Diya", "Kabir", "Meera", "Arjun", "Ananya", "Vihaan", "Ishita", "Rohan", "Saanvi", "Aditya", "Kavya", "Nikhil", "Pooja", "Siddharth", "Tanvi", "Yash", "Zoya", "Harsh", "Neha", "Kunal", "Sneha", "Varun"];
const LAST = ["Sharma", "Mehta", "Rao", "Singh", "Iyer", "Patel", "Gupta", "Reddy", "Nair", "Das", "Joshi", "Kulkarni", "Banerjee", "Verma", "Chopra", "Menon", "Pillai", "Saxena", "Khan", "Agarwal", "Bose", "Malhotra", "Chauhan", "Tiwari"];

// Evening is busiest; there's a small lunchtime bump
const HOUR_WEIGHTS = { 7: 1, 8: 1, 9: 1, 10: 1, 11: 2, 12: 3, 13: 3, 14: 2, 15: 3, 16: 5, 17: 8, 18: 9, 19: 8, 20: 5, 21: 2 };
const weightedHour = () => {
  const total = Object.values(HOUR_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (const [hour, weight] of Object.entries(HOUR_WEIGHTS)) {
    roll -= weight;
    if (roll <= 0) return Number(hour);
  }
  return 18;
};

const DURATIONS = [30, 60, 60, 60, 90, 120];

// ---------------------------------------------------------------- run

const confirmReset = async () => {
  if (env.isProduction && !process.argv.includes("--allow-production")) {
    throw new Error("Refusing to seed a production database. Pass --allow-production if you really mean it.");
  }
  const [users, admins] = await Promise.all([prisma.user.count(), prisma.admin.count()]);
  if ((users > 0 || admins > 0) && !process.argv.includes("--yes")) {
    throw new Error(
      `This database already has ${users} students and ${admins} staff accounts. ` +
        "Seeding replaces everything; run `npm run seed -- --yes` to go ahead."
    );
  }
};

const wipe = async () => {
  // Children first so foreign keys never block a delete
  await prisma.notification.deleteMany();
  await prisma.ticketEvent.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.roomBooking.deleteMany();
  await prisma.room.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.equipmentHistory.deleteMany();
  await prisma.message.deleteMany();
  await prisma.userGameRating.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.game.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.user.deleteMany();
  await prisma.admin.deleteMany();
};

export const seed = async ({ now = new Date() } = {}) => {
  const password = await hashPassword(DEMO_PASSWORD);

  // Staff
  const staff = await Promise.all([
    prisma.admin.create({ data: { ...DEMO_STAFF, password } }),
    prisma.admin.create({ data: { email: "office@iiita.ac.in", name: "Neha Gupta", password } }),
  ]);

  // Games and equipment
  const games = {};
  const equipment = [];
  for (const [name, items] of Object.entries(GAMES)) {
    const game = await prisma.game.create({ data: { name } });
    games[name] = game;
    for (const itemName of items) {
      equipment.push(await prisma.equipment.create({ data: { name: itemName, games: { connect: { id: game.id } } } }));
    }
  }

  // Students: the first is the main demo account
  const students = [];
  for (let i = 0; i < FIRST.length; i += 1) {
    const roll = `IIT2023${String(i + 1).padStart(3, "0")}`;
    const fullname = `${FIRST[i]} ${LAST[i]}`;
    const user = await prisma.user.create({
      data: {
        fullname,
        username: FIRST[i].toLowerCase() + (i === 0 ? "" : String(i + 1)),
        email: `${roll.toLowerCase()}@iiita.ac.in`,
        roll_no: roll,
        phone_number: `98${String(76543210 + i * 7919).slice(-8)}`,
        password,
        isVerified: true,
        achievements: i % 5 === 0 ? ["Inter-IIIT sports meet, 2025"] : [],
      },
    });
    students.push(user);
    const gameNames = Object.keys(GAMES);
    const played = new Set([gameNames[i % gameNames.length], pick(gameNames)]);
    await prisma.userGameRating.createMany({
      data: [...played].map((g) => ({ userId: user.id, gameId: games[g].id, rating: between(2, 5) })),
    });
  }
  const demo = students[0];
  const blockedStudent = students[3];

  // Four weeks of checkouts. Each item can only be out once at a time.
  const loans = [];
  const history = [];
  const busyUntil = new Map(equipment.map((e) => [e.id, 0]));
  const historyExpiry = new Date(now.getTime() + HISTORY_RETENTION_DAYS * DAY);
  const today = zonedParts(now);

  for (let daysAgo = 28; daysAgo >= 1; daysAgo -= 1) {
    const day = zonedParts(new Date(zonedTimeToDate({ ...today, hour: 12 }).getTime() - daysAgo * DAY));
    const weekend = new Date(zonedTimeToDate({ ...day, hour: 12 })).getUTCDay() % 6 === 0;
    const count = between(weekend ? 26 : 16, weekend ? 40 : 30);
    const starts = Array.from({ length: count }, () =>
      zonedTimeToDate({ year: day.year, month: day.month, day: day.day, hour: weightedHour(), minute: pick([0, 5, 10, 15, 20, 30, 40, 45, 50]) })
    ).sort((a, b) => a - b);

    for (const issuedAt of starts) {
      const free = equipment.filter((e) => busyUntil.get(e.id) <= issuedAt.getTime());
      if (free.length === 0) continue;
      const item = pick(free);
      // The blocked student's late returns are all in the last ten days
      const student = daysAgo <= 10 && random() < 0.05 ? blockedStudent : pick(students);
      const duration = pick(DURATIONS);
      const dueAt = new Date(issuedAt.getTime() + duration * MINUTE);
      // The main demo student always returns on time so their account isn't blocked
      const late = (student.id === blockedStudent.id && daysAgo <= 10) || (student.id !== demo.id && random() < 0.07);
      const actual = late ? duration + between(LATE_GRACE_MINUTES + 5, 90) : Math.max(10, duration - between(0, 25));
      const returnedAt = new Date(issuedAt.getTime() + actual * MINUTE);
      busyUntil.set(item.id, returnedAt.getTime() + 5 * MINUTE);
      const issuer = pick(staff);

      loans.push({
        equipmentId: item.id,
        userId: student.id,
        roll_no: student.roll_no,
        issuedAt,
        dueAt,
        returnedAt,
        issuedById: issuer.id,
        returnedToId: pick(staff).id,
        dueSoonNotifiedAt: dueAt,
        overdueNotifiedAt: late ? dueAt : null,
      });
      history.push(
        { equipmentId: item.id, status: "in_use", roll_no: student.roll_no, dueAt, userId: student.id, changedById: issuer.id, changedAt: issuedAt, expireAt: historyExpiry },
        { equipmentId: item.id, status: "available", changedById: issuer.id, changedAt: returnedAt, expireAt: historyExpiry }
      );
    }
  }
  await prisma.loan.createMany({ data: loans });
  await prisma.equipmentHistory.createMany({ data: history });

  // Right now: a handful of items out, two of them overdue, one with the demo student
  const outNow = [
    { item: equipment[0], student: demo, issuedMinutesAgo: 25, duration: 180 },
    { item: equipment[6], student: students[1], issuedMinutesAgo: 40, duration: 90 },
    { item: equipment[16], student: students[2], issuedMinutesAgo: 15, duration: 60 },
    { item: equipment[22], student: students[5], issuedMinutesAgo: 130, duration: 90 },
    { item: equipment[27], student: students[7], issuedMinutesAgo: 95, duration: 60 },
  ];
  for (const { item, student, issuedMinutesAgo, duration } of outNow) {
    const issuedAt = new Date(now.getTime() - issuedMinutesAgo * MINUTE);
    const dueAt = new Date(issuedAt.getTime() + duration * MINUTE);
    const overdue = dueAt < now;
    await prisma.loan.create({
      data: {
        equipmentId: item.id,
        userId: student.id,
        roll_no: student.roll_no,
        issuedAt,
        dueAt,
        issuedById: staff[0].id,
        overdueNotifiedAt: overdue ? dueAt : null,
      },
    });
    await prisma.equipment.update({
      where: { id: item.id },
      data: { status: "in_use", userId: student.id, roll_no: student.roll_no, issuedAt, dueAt },
    });
    await prisma.equipmentHistory.create({
      data: { equipmentId: item.id, status: "in_use", roll_no: student.roll_no, dueAt, userId: student.id, changedById: staff[0].id, changedAt: issuedAt, expireAt: historyExpiry },
    });
  }

  // One item broken, one held by another student
  await prisma.equipment.update({ where: { id: equipment[30].id }, data: { status: "broken" } });
  await prisma.equipmentHistory.create({
    data: { equipmentId: equipment[30].id, status: "broken", changedById: staff[1].id, changedAt: new Date(now.getTime() - 2 * DAY), expireAt: historyExpiry },
  });
  await prisma.equipment.update({
    where: { id: equipment[10].id },
    data: { reservedById: students[4].id, reservedUntil: new Date(now.getTime() + 11 * MINUTE) },
  });

  // Rooms and bookings for today and the next few days
  const rooms = [];
  for (const room of ROOMS) rooms.push(await prisma.room.create({ data: room }));
  const bookingAt = (dayOffset, hour) => {
    const day = zonedParts(new Date(now.getTime() + dayOffset * DAY));
    return zonedTimeToDate({ year: day.year, month: day.month, day: day.day, hour });
  };
  const nowHour = zonedParts(now).hour;
  const bookings = [
    { room: rooms[0], user: demo, day: 1, hour: 17, hours: 2, purpose: "Band practice" },
    { room: rooms[1], user: students[6], day: 0, hour: Math.min(Math.max(nowHour + 1, 7), 20), hours: 2, purpose: "Play rehearsal" },
    { room: rooms[2], user: students[8], day: 0, hour: 18, hours: 1, purpose: "Dance club" },
    { room: rooms[0], user: students[9], day: 0, hour: 19, hours: 2, purpose: null },
    { room: rooms[4], user: students[10], day: 2, hour: 16, hours: 1, purpose: "Doubles practice" },
    { room: rooms[3], user: students[11], day: 3, hour: 15, hours: 2, purpose: "Poster painting" },
  ];
  for (const b of bookings) {
    const startsAt = bookingAt(b.day, b.hour);
    await prisma.roomBooking.create({
      data: { roomId: b.room.id, userId: b.user.id, startsAt, endsAt: new Date(startsAt.getTime() + b.hours * HOUR), purpose: b.purpose },
    });
  }

  // Tickets with timelines
  const ticket = async ({ sender, kind, heading, content, equipmentId, requestedGame, requestedItem, daysAgo, steps = [] }) => {
    const createdAt = new Date(now.getTime() - daysAgo * DAY);
    const t = await prisma.ticket.create({
      data: { kind, heading, content, senderId: sender.id, equipmentId, requestedGame, requestedItem, createdAt },
    });
    await prisma.ticketEvent.create({ data: { ticketId: t.id, type: "created", toStatus: "open", authorUserId: sender.id, createdAt } });
    let status = "open";
    for (const [i, step] of steps.entries()) {
      const at = new Date(createdAt.getTime() + (i + 1) * 3 * HOUR);
      if (step.status) {
        await prisma.ticketEvent.create({
          data: { ticketId: t.id, type: "status_changed", fromStatus: status, toStatus: step.status, body: step.note ?? null, authorAdminId: staff[0].id, createdAt: at },
        });
        status = step.status;
      } else {
        await prisma.ticketEvent.create({
          data: { ticketId: t.id, type: "comment", body: step.reply, authorAdminId: step.staff ? staff[1].id : null, authorUserId: step.staff ? null : sender.id, createdAt: at },
        });
      }
    }
    await prisma.ticket.update({ where: { id: t.id }, data: { status, closedAt: status === "closed" ? new Date(createdAt.getTime() + steps.length * 3 * HOUR) : null } });
  };

  await ticket({
    sender: demo,
    kind: "broken",
    heading: "Cue tip has come off",
    content: "The tip on snooker cue 3 fell off during a game this evening.",
    equipmentId: equipment[30].id,
    daysAgo: 2,
    steps: [{ status: "in_process", note: "Ordered new tips; they should arrive this week." }, { staff: true, reply: "Tips arrived. Fixing it tomorrow morning." }],
  });
  await ticket({
    sender: demo,
    kind: "request",
    heading: "More shuttlecocks for the inter-batch tournament",
    content: "We go through a tube every evening during practice week. Could we get four more tubes?",
    requestedGame: "badminton",
    requestedItem: "shuttlecock tube",
    daysAgo: 9,
    steps: [{ staff: true, reply: "How many players are registered?" }, { reply: "About 40 across all batches." }, { status: "closed", note: "Four tubes added to the rack." }],
  });
  await ticket({
    sender: students[2],
    kind: "broken",
    heading: "Football won't hold air",
    content: "Football 2 goes flat within ten minutes.",
    equipmentId: equipment[21].id,
    daysAgo: 1,
  });
  await ticket({
    sender: students[12],
    kind: "request",
    heading: "A second carrom striker",
    content: "Board 2 only has one striker, so doubles games keep stopping.",
    requestedGame: "carrom",
    requestedItem: "striker",
    daysAgo: 4,
    steps: [{ status: "in_process" }],
  });

  // Announcements
  await prisma.announcement.createMany({
    data: [
      { heading: "Badminton courts closed Saturday morning", content: "The floor is being resurfaced. Courts reopen at 2 PM.", footer: "SAC office", expireAt: new Date(now.getTime() + 6 * DAY), createdById: staff[1].id, createdAt: new Date(now.getTime() - 5 * HOUR) },
      { heading: "New table tennis bats", content: "Four new bats are on the rack. Please return them in their covers.", footer: "", expireAt: new Date(now.getTime() + 20 * DAY), createdById: staff[0].id, createdAt: new Date(now.getTime() - 2 * DAY) },
      { heading: "Inter-batch tournament sign-ups", content: "Sign up at the desk by Friday for badminton, table tennis and chess.", footer: "Sports council", expireAt: new Date(now.getTime() + 10 * DAY), createdById: staff[1].id, createdAt: new Date(now.getTime() - 4 * DAY) },
    ],
  });

  // A couple of conversations for the demo student
  const chat = async (a, b, lines, startMinutesAgo) => {
    for (const [i, [fromA, content]] of lines.entries()) {
      await prisma.message.create({
        data: {
          senderId: fromA ? a.id : b.id,
          receiverId: fromA ? b.id : a.id,
          content,
          status: i === lines.length - 1 && !fromA ? "sent" : "read",
          createdAt: new Date(now.getTime() - (startMinutesAgo - i * 6) * MINUTE),
        },
      });
    }
  };
  await chat(demo, students[1], [[true, "Hey! Would you like to play badminton sometime?"], [false, "Sure, I'm free after class."], [false, "6 PM works for me"]], 60);
  await chat(demo, students[2], [[false, "Table tennis tomorrow?"], [true, "Yes! I'll reserve a bat."]], 1500);

  // Notifications for the demo student
  await prisma.notification.createMany({
    data: [
      { userId: demo.id, type: "ticket_reply", title: 'The desk replied on "Cue tip has come off"', body: "Tips arrived. Fixing it tomorrow morning.", link: "/student/tickets", createdAt: new Date(now.getTime() - 3 * HOUR) },
      { userId: demo.id, type: "announcement", title: "Badminton courts closed Saturday morning", body: "The floor is being resurfaced. Courts reopen at 2 PM.", link: "/announcements", createdAt: new Date(now.getTime() - 5 * HOUR) },
      { userId: demo.id, type: "ticket_updated", title: '"More shuttlecocks for the inter-batch tournament" is now closed', body: "Four tubes added to the rack.", link: "/student/tickets", readAt: new Date(now.getTime() - 2 * DAY), createdAt: new Date(now.getTime() - 3 * DAY) },
    ],
  });

  return { students: students.length, staff: staff.length, equipment: equipment.length, loans: loans.length + outNow.length, rooms: rooms.length };
};

const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  try {
    await confirmReset();
    await wipe();
    const summary = await seed();
    console.log("Seeded:", summary);
    console.log(`\nStudent: ${DEMO_STUDENT_EMAIL} / ${DEMO_PASSWORD}\nStaff:   ${DEMO_STAFF.email} / ${DEMO_PASSWORD}`);
    await disconnectDB();
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    await disconnectDB();
    process.exit(1);
  }
}

export { wipe };
