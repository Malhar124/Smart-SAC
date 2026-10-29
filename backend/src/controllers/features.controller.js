// Handlers for the features students and staff share (equipment, tickets, rooms, notifications,
// busy times, live events). The business rules live in src/services; these only map HTTP to them.
import { ApiResponse } from "../utils/ApiResponse.js";
import { prisma } from "../db/index.js";
import { publish, subscribe } from "../lib/events.js";
import { toDateKey } from "../lib/time.js";
import * as equipment from "../services/equipment.service.js";
import * as tickets from "../services/tickets.service.js";
import * as rooms from "../services/rooms.service.js";
import { getUsage } from "../services/usage.service.js";

const ok = (res, data, message, status = 200) => res.status(status).json(new ApiResponse(status, data, message));

// ---------------------------------------------------------------- live events

export const streamEvents = (req, res) => subscribe(req, res);

// ---------------------------------------------------------------- equipment (students)

export const reserveEquipment = async (req, res) =>
  ok(res, await equipment.reserveEquipment({ equipmentId: req.body.equipmentId, user: req.user }), "Reserved. Collect it from the SAC desk.");

export const cancelReservation = async (req, res) => {
  await equipment.cancelReservation({ equipmentId: req.body.equipmentId, userId: req.user.id });
  return ok(res, { equipmentId: req.body.equipmentId }, "Reservation cancelled");
};

// ---------------------------------------------------------------- equipment (staff)

export const getEquipmentForStaff = async (req, res) => ok(res, await equipment.listEquipmentForStaff(), "Equipment");

export const lendEquipment = async (req, res) => {
  const result = await equipment.lendEquipment({ ...req.body, adminId: req.user.id });
  return ok(res, result, result.overrodeBlock ? "Lent (borrowing block overridden)" : "Lent");
};

export const returnEquipment = async (req, res) => {
  const result = await equipment.returnEquipment({ equipmentId: req.body.equipmentId, adminId: req.user.id });
  return ok(res, result, result.late ? "Marked returned (late)" : "Marked returned");
};

export const setEquipmentStatus = async (req, res) =>
  ok(res, await equipment.setEquipmentStatus({ ...req.body, adminId: req.user.id }), "Status saved");

export const releaseReservation = async (req, res) => {
  await equipment.releaseReservation({ equipmentId: req.body.equipmentId });
  return ok(res, { equipmentId: req.body.equipmentId }, "Hold released");
};

export const getStudent = async (req, res) => ok(res, await equipment.getStudentSummary(req.params.rollNo), "Student");

// ---------------------------------------------------------------- busy times

export const getUsageStats = async (req, res) => ok(res, await getUsage(req.query), "Usage");

// ---------------------------------------------------------------- tickets

export const createBrokenTicket = async (req, res) =>
  ok(res, await tickets.createTicket({ user: req.user, kind: "broken", ...req.body }), "Report sent", 201);

export const createRequestTicket = async (req, res) => {
  const { game, equipment: item, heading, details } = req.body;
  const ticket = await tickets.createTicket({
    user: req.user,
    kind: "request",
    heading,
    content: details,
    requestedGame: game,
    requestedItem: item,
  });
  return ok(res, ticket, "Request sent", 201);
};

export const getMyTickets = async (req, res) => ok(res, await tickets.listTicketsForUser(req.user.id), "Your tickets");

export const getMyTicket = async (req, res) => ok(res, await tickets.getTicketForUser(req.params.ticketId, req.user.id), "Ticket");

export const commentAsStudent = async (req, res) =>
  ok(res, await tickets.addTicketComment({ ticketId: req.params.ticketId, author: { kind: "user", id: req.user.id }, body: req.body.body }), "Reply sent", 201);

export const getTicketsForStaff = async (req, res) => ok(res, await tickets.listTicketsForStaff(req.query), "Tickets");

export const getTicketForStaff = async (req, res) => ok(res, await tickets.getTicketForStaff(req.params.ticketId), "Ticket");

export const commentAsStaff = async (req, res) =>
  ok(res, await tickets.addTicketComment({ ticketId: req.params.ticketId, author: { kind: "admin", id: req.user.id }, body: req.body.body }), "Reply sent", 201);

export const updateTicketStatus = async (req, res) =>
  ok(
    res,
    await tickets.changeTicketStatus({ ticketId: req.body.ticketId, adminId: req.user.id, status: req.body.newStatus, note: req.body.note }),
    "Ticket updated"
  );

// ---------------------------------------------------------------- rooms

export const getRoomsForStudent = async (req, res) =>
  ok(res, await rooms.getRoomsForDay({ dateKey: req.query.date ?? toDateKey(new Date()), viewerUserId: req.user.id }), "Rooms");

export const getMyRoomBookings = async (req, res) => ok(res, await rooms.listUpcomingBookingsForUser(req.user.id), "Your bookings");

export const bookRoom = async (req, res) => ok(res, await rooms.bookRoom({ userId: req.user.id, ...req.body }), "Room booked", 201);

export const cancelMyRoomBooking = async (req, res) => {
  await rooms.cancelOwnBooking({ bookingId: req.params.bookingId, userId: req.user.id });
  return ok(res, { bookingId: req.params.bookingId }, "Booking cancelled");
};

export const getRoomsForStaff = async (req, res) =>
  ok(res, await rooms.getRoomsForDay({ dateKey: req.query.date ?? toDateKey(new Date()), staff: true }), "Rooms");

export const addRoom = async (req, res) => ok(res, await rooms.createRoom(req.body), "Room added", 201);

export const updateRoom = async (req, res) => ok(res, await rooms.updateRoom(req.params.roomId, req.body, req.user.id), "Room saved");

export const removeRoom = async (req, res) => {
  await rooms.removeRoom(req.params.roomId);
  return ok(res, { roomId: req.params.roomId }, "Room removed");
};

export const cancelRoomBookingAsStaff = async (req, res) => {
  await rooms.cancelBookingAsStaff({ bookingId: req.params.bookingId, adminId: req.user.id, reason: req.body?.reason });
  return ok(res, { bookingId: req.params.bookingId }, "Booking cancelled");
};

// ---------------------------------------------------------------- notifications

export const getNotifications = async (req, res) => {
  const { limit } = req.query;
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
  ]);
  return ok(res, { notifications, unread }, "Notifications");
};

export const markNotificationsRead = async (req, res) => {
  const { ids } = req.body;
  const { count } = await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  // Other open tabs update their badge
  if (count > 0) publish("notification.read", {}, { users: [req.user.id] });
  return ok(res, { marked: count }, "Marked as read");
};
