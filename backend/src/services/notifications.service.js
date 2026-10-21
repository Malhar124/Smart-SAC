import { prisma } from "../db/index.js";
import { publish } from "../lib/events.js";

/** Create an in-app notification for one student and push it to their open tabs */
export const notify = async (userId, { type, title, body, link = null }) => {
  if (!userId) return null;
  const notification = await prisma.notification.create({ data: { userId, type, title, body, link } });
  publish("notification.new", { id: notification.id }, { users: [userId] });
  return notification;
};

/** Same notification for every student with a confirmed account (e.g. a new announcement) */
export const notifyAllStudents = async ({ type, title, body, link = null }) => {
  const users = await prisma.user.findMany({ where: { isVerified: true }, select: { id: true } });
  if (users.length === 0) return 0;
  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type, title, body, link })),
  });
  publish("notification.new", {}, { allUsers: true });
  return users.length;
};
