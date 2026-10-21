import { prisma } from "../db/index.js";
import { ApiError } from "../utils/ApiError.js";
import { publish } from "../lib/events.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { emailTemplate, sendMail } from "../utils/mail.js";
import { notify } from "./notifications.service.js";

export const STATUS_LABEL = { open: "Open", in_process: "In progress", closed: "Closed" };

const ticketInclude = {
  equipment: { select: { id: true, name: true } },
  sender: { select: { id: true, fullname: true, roll_no: true, email: true } },
  events: {
    orderBy: { createdAt: "asc" },
    include: {
      authorUser: { select: { id: true, fullname: true } },
      authorAdmin: { select: { id: true, name: true, email: true } },
    },
  },
};

const toEventView = (e) => ({
  id: e.id,
  type: e.type,
  fromStatus: e.fromStatus,
  toStatus: e.toStatus,
  body: e.body,
  createdAt: e.createdAt,
  author: e.authorAdmin
    ? { kind: "staff", name: e.authorAdmin.name || e.authorAdmin.email }
    : e.authorUser
      ? { kind: "student", name: e.authorUser.fullname }
      : null,
});

const toTicketView = (t) => ({
  id: t.id,
  kind: t.kind,
  heading: t.heading,
  content: t.content,
  status: t.status,
  requestedGame: t.requestedGame,
  requestedItem: t.requestedItem,
  equipment: t.equipment,
  sender: t.sender,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  closedAt: t.closedAt,
  ...(t.events ? { events: t.events.map(toEventView) } : {}),
  ...(t._count ? { replies: t._count.events } : {}),
});

const audienceFor = (ticket) => ({ admins: true, users: [ticket.senderId] });

/** Email the sports head about a new ticket. Never fails the request: the ticket is already saved. */
const emailSportsHead = async (ticket, sender) => {
  if (!env.SPORTS_HEAD_EMAIL) return;
  try {
    await sendMail({
      to: env.SPORTS_HEAD_EMAIL,
      subject: ticket.kind === "broken" ? `Broken equipment: ${ticket.heading}` : `Equipment request: ${ticket.heading}`,
      html: emailTemplate({
        title: ticket.kind === "broken" ? "Broken equipment report" : "New equipment request",
        lines: [
          ticket.kind === "broken"
            ? `Item: ${ticket.equipment?.name ?? "Unknown"}`
            : `Game: ${ticket.requestedGame}. Item: ${ticket.requestedItem}.`,
          ticket.heading,
          ticket.content,
          `From ${sender.fullname} (${sender.roll_no}).`,
        ],
        footnote: "Reply from the Tickets page in Smart SAC so the student sees it.",
      }),
    });
  } catch (error) {
    logger.warn({ ticketId: ticket.id, reason: error?.code || error?.message }, "ticket notification email failed");
  }
};

export const createTicket = async ({ user, kind, equipmentId, heading, content, requestedGame, requestedItem }) => {
  if (kind === "broken") {
    const item = await prisma.equipment.findUnique({ where: { id: equipmentId }, select: { id: true } });
    if (!item) throw new ApiError(404, "That item doesn't exist.");
  }

  const ticket = await prisma.ticket.create({
    data: {
      kind,
      heading,
      content,
      senderId: user.id,
      equipmentId: kind === "broken" ? equipmentId : null,
      requestedGame: kind === "request" ? requestedGame : null,
      requestedItem: kind === "request" ? requestedItem : null,
      events: { create: { type: "created", toStatus: "open", authorUserId: user.id } },
    },
    include: ticketInclude,
  });

  void emailSportsHead(ticket, user);
  publish("ticket.changed", { ticketId: ticket.id }, audienceFor(ticket));
  return toTicketView(ticket);
};

export const listTicketsForUser = async (userId) => {
  const tickets = await prisma.ticket.findMany({
    where: { senderId: userId },
    orderBy: { updatedAt: "desc" },
    include: {
      equipment: { select: { id: true, name: true } },
      _count: { select: { events: { where: { type: "comment" } } } },
    },
  });
  return tickets.map(toTicketView);
};

export const getTicketForUser = async (ticketId, userId) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: ticketInclude });
  if (!ticket || ticket.senderId !== userId) throw new ApiError(404, "You don't have that ticket.");
  return toTicketView(ticket);
};

export const getTicketForStaff = async (ticketId) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: ticketInclude });
  if (!ticket) throw new ApiError(404, "That ticket doesn't exist.");
  return toTicketView(ticket);
};

export const listTicketsForStaff = async ({ status, page, pageSize = 20, q }) => {
  const where = {
    ...(status !== "all" && { status }),
    ...(q && {
      OR: [
        { heading: { contains: q, mode: "insensitive" } },
        { content: { contains: q, mode: "insensitive" } },
        { sender: { fullname: { contains: q, mode: "insensitive" } } },
        { sender: { roll_no: { contains: q, mode: "insensitive" } } },
        { equipment: { name: { contains: q, mode: "insensitive" } } },
      ],
    }),
  };
  const [total, tickets, counts] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        equipment: { select: { id: true, name: true } },
        sender: { select: { id: true, fullname: true, roll_no: true, email: true } },
        _count: { select: { events: { where: { type: "comment" } } } },
      },
    }),
    prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  return {
    tickets: tickets.map(toTicketView),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    counts: {
      all: counts.reduce((sum, c) => sum + c._count._all, 0),
      open: byStatus.open ?? 0,
      in_process: byStatus.in_process ?? 0,
      closed: byStatus.closed ?? 0,
    },
  };
};

/** A reply on the ticket's timeline, from the student who opened it or from staff */
export const addTicketComment = async ({ ticketId, author, body }) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || (author.kind === "user" && ticket.senderId !== author.id)) {
    throw new ApiError(404, "You don't have that ticket.");
  }
  if (ticket.status === "closed") {
    throw new ApiError(409, "This ticket is closed. Open a new one if the problem is back.");
  }

  await prisma.$transaction([
    prisma.ticketEvent.create({
      data: {
        ticketId,
        type: "comment",
        body,
        authorUserId: author.kind === "user" ? author.id : null,
        authorAdminId: author.kind === "admin" ? author.id : null,
      },
    }),
    // Bump updatedAt so the ticket rises to the top of both lists
    prisma.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } }),
  ]);

  if (author.kind === "admin") {
    await notify(ticket.senderId, {
      type: "ticket_reply",
      title: `The desk replied on "${ticket.heading}"`,
      body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
      link: `/student/tickets?ticket=${ticketId}`,
    });
  }
  publish("ticket.changed", { ticketId }, audienceFor(ticket));
  return author.kind === "admin" ? getTicketForStaff(ticketId) : getTicketForUser(ticketId, author.id);
};

/** Staff move a ticket between open, in progress and closed, optionally with a note to the student */
export const changeTicketStatus = async ({ ticketId, adminId, status, note }) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new ApiError(404, "That ticket doesn't exist.");
  if (ticket.status === status) throw new ApiError(409, `This ticket is already ${STATUS_LABEL[status].toLowerCase()}.`);

  await prisma.$transaction([
    prisma.ticket.update({
      where: { id: ticketId },
      data: { status, closedAt: status === "closed" ? new Date() : null },
    }),
    prisma.ticketEvent.create({
      data: {
        ticketId,
        type: "status_changed",
        fromStatus: ticket.status,
        toStatus: status,
        body: note || null,
        authorAdminId: adminId,
      },
    }),
  ]);

  await notify(ticket.senderId, {
    type: "ticket_updated",
    title: `"${ticket.heading}" is now ${STATUS_LABEL[status].toLowerCase()}`,
    body: note || (status === "closed" ? "The desk closed this ticket." : "The desk updated this ticket."),
    link: `/student/tickets?ticket=${ticketId}`,
  });
  publish("ticket.changed", { ticketId }, audienceFor(ticket));
  return getTicketForStaff(ticketId);
};

export const countOpenTicketsForUser = (userId) =>
  prisma.ticket.count({ where: { senderId: userId, status: { in: ["open", "in_process"] } } });
