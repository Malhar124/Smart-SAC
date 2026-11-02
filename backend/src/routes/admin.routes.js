import { z } from "../lib/zod.js";
import { createRoutes } from "../lib/route.js";
import { authLimiter } from "../middlewares/rateLimit.middleware.js";
import * as v from "../validation/common.js";
import * as admin from "../controllers/admin.controller.js";
import * as features from "../controllers/features.controller.js";
import { LOAN_MAX_MINUTES, LOAN_MIN_MINUTES } from "../config/policy.js";

const routes = createRoutes({ prefix: "/admin", tag: "Staff" });
const { get, post, delete: del } = routes;

// ---------------------------------------------------------------- schemas

const StaffName = v.shortText("Name", 60);

const RegisterBody = z.object({ email: v.email });
const ConfirmRegistrationBody = z.object({ name: StaffName, email: v.email, password: v.password, token: v.otp });
const LoginBody = z.object({ email: v.email, password: z.string().min(1, "Enter your password") });

const EquipmentIdBody = z.object({ equipmentId: v.id });
const LendBody = z.object({
  equipmentId: v.id,
  rollNo: v.rollNo,
  durationMinutes: z.coerce
    .number()
    .int()
    .min(LOAN_MIN_MINUTES, `Lend for at least ${LOAN_MIN_MINUTES} minutes`)
    .max(LOAN_MAX_MINUTES, `Lend for at most ${LOAN_MAX_MINUTES / 60} hours`),
  overrideBlock: z.boolean().default(false),
});
const SetStatusBody = z.object({
  equipmentId: v.id,
  status: z.enum(["available", "broken"], { message: "Status must be available or broken" }),
});

const GameNameBody = z.object({ name: v.shortText("Game name", 40).transform((s) => s.toLowerCase()) });
const GameIdBody = z.object({ gameId: v.id });
const AddEquipmentBody = z.object({ gameId: v.id, name: v.shortText("Item name", 60).transform((s) => s.toLowerCase()) });

const TicketStatus = z.enum(["open", "in_process", "closed"], { message: "Status must be open, in_process or closed" });
const TicketsQuery = z.object({
  status: z.enum(["all", "open", "in_process", "closed"]).default("all"),
  page: v.page,
  q: z.string().trim().max(80).optional(),
});
const UpdateTicketBody = z.object({
  ticketId: v.id,
  newStatus: TicketStatus,
  note: z.string().trim().max(1000, "Keep the note under 1000 characters").optional(),
});
const CommentBody = z.object({ body: v.longText("Reply", 2000) });

const AnnouncementBody = z.object({
  heading: v.shortText("Heading", 120),
  content: v.longText("Message", 2000),
  footer: z.string().trim().max(120).optional(),
  expiresInDays: z.coerce.number().int().min(1, "Keep it up for at least a day").max(365, "Keep it up for at most a year").default(30),
});

const PageQuery = z.object({ page: v.page });
const SearchQuery = z.object({ q: z.string().trim().min(1, "Type something to search").max(80) });
const UsageQuery = z.object({
  days: z.coerce.number().int().refine((d) => [7, 14, 28, 56].includes(d), "Pick 7, 14, 28 or 56 days").default(28),
  gameId: v.id.optional(),
});

const RoomsQuery = z.object({ date: v.dateKey.optional() });
const RoomBody = z.object({
  name: v.shortText("Room name", 60),
  capacity: z.coerce.number().int().min(1, "Capacity is at least 1").max(500),
  description: z.string().trim().max(200).optional(),
});
const UpdateRoomBody = RoomBody.partial()
  .extend({ status: z.enum(["available", "maintenance"]).optional() })
  .refine((b) => Object.values(b).some((value) => value !== undefined), { message: "Change at least one field" });
const CancelBookingBody = z.object({ reason: z.string().trim().max(200).optional() });

// ---------------------------------------------------------------- account

post("/register", { summary: "Email a code to a staff address (must be in ADMIN_EMAILS) to create its account or reset its password", limiter: authLimiter, body: RegisterBody, tags: ["Auth"] }, admin.registerAdmin);
post("/confirm-registration", { summary: "Set the staff name and password with the emailed code; a reset signs out every device", limiter: authLimiter, body: ConfirmRegistrationBody, tags: ["Auth"] }, admin.confirmAdminRegistration);
post("/login", { summary: "Staff sign in; sets the session cookies", limiter: authLimiter, body: LoginBody, tags: ["Auth"] }, admin.loginAdmin);
post("/logout", { summary: "Sign out and revoke the refresh token", auth: "admin", tags: ["Auth"] }, admin.logoutAdmin);
post("/refresh-token", { summary: "Rotate the session cookies using the refresh-token cookie", tags: ["Auth"] }, admin.refreshAccessToken);
get("/current-admin", { summary: "The signed-in staff member", auth: "admin", tags: ["Auth"] }, admin.getCurrentAdmin);

// ---------------------------------------------------------------- desk

get("/dashboard", { summary: "Counts, overdue loans and recent announcements", auth: "admin" }, admin.dashboardDetails);
get("/search", { summary: "Find equipment, students, rooms and tickets (command palette)", auth: "admin", query: SearchQuery }, admin.search);
get("/get-student/:rollNo", { summary: "A roll number's account, loans, hold and borrowing standing", auth: "admin", params: z.object({ rollNo: v.rollNo }), tags: ["Equipment"] }, features.getStudent);
get("/get-usage", { summary: "Average items out per hour over recent days", auth: "admin", query: UsageQuery, tags: ["Equipment"] }, features.getUsageStats);

// ---------------------------------------------------------------- equipment

get("/get-equipment", { summary: "Every item with holder, due time and any hold", auth: "admin", tags: ["Equipment"] }, features.getEquipmentForStaff);
post("/lend-equipment", { summary: "Lend a free item to a roll number until a due time", auth: "admin", body: LendBody, tags: ["Equipment"] }, features.lendEquipment);
post("/return-equipment", { summary: "Mark an item returned; reports whether it was late", auth: "admin", body: EquipmentIdBody, tags: ["Equipment"] }, features.returnEquipment);
post("/set-equipment-status", { summary: "Mark an item free or broken", auth: "admin", body: SetStatusBody, tags: ["Equipment"] }, features.setEquipmentStatus);
post("/release-reservation", { summary: "Release a student's hold on an item", auth: "admin", body: EquipmentIdBody, tags: ["Equipment"] }, features.releaseReservation);

get("/get-games", { summary: "Games with their equipment", auth: "admin", tags: ["Equipment"] }, admin.getGames);
post("/add-game", { summary: "Add a game", auth: "admin", body: GameNameBody, tags: ["Equipment"] }, admin.addGame);
post("/remove-game", { summary: "Remove a game and its equipment", auth: "admin", body: GameIdBody, tags: ["Equipment"] }, admin.removeGame);
post("/add-equipment", { summary: "Add an item to a game", auth: "admin", body: AddEquipmentBody, tags: ["Equipment"] }, admin.addEquipment);
post("/remove-equipment", { summary: "Remove an item (it must not be out)", auth: "admin", body: EquipmentIdBody, tags: ["Equipment"] }, admin.removeEquipment);

get("/get-recent-equipment-history", { summary: "The latest status changes across all items", auth: "admin", tags: ["Equipment"] }, admin.getRecentEquipmentHistory);
get("/get-equipment-history-overview", { summary: "Every item with its latest changes", auth: "admin", tags: ["Equipment"] }, admin.getEquipmentHistoryOverview);
get("/get-equipment-history/:equipmentId", { summary: "One item's full history, paginated", auth: "admin", params: v.idParam("equipmentId"), query: PageQuery, tags: ["Equipment"] }, admin.getEquipmentHistory);

// ---------------------------------------------------------------- tickets

get("/get-tickets", { summary: "Tickets filtered by status, with counts per status", auth: "admin", query: TicketsQuery, tags: ["Tickets"] }, features.getTicketsForStaff);
get("/get-ticket/:ticketId", { summary: "A ticket with its timeline", auth: "admin", params: v.idParam("ticketId"), tags: ["Tickets"] }, features.getTicketForStaff);
post("/update-ticket", { summary: "Change a ticket's status, optionally with a note to the student", auth: "admin", body: UpdateTicketBody, tags: ["Tickets"] }, features.updateTicketStatus);
post("/add-ticket-comment/:ticketId", { summary: "Reply to the student on a ticket", auth: "admin", params: v.idParam("ticketId"), body: CommentBody, tags: ["Tickets"] }, features.commentAsStaff);

// ---------------------------------------------------------------- announcements

post("/make-announcement", { summary: "Post an announcement and notify every student", auth: "admin", body: AnnouncementBody, tags: ["Announcements"] }, admin.makeAnnouncement);
get("/get-announcements", { summary: "Announcements with who posted them", auth: "admin", query: PageQuery, tags: ["Announcements"] }, admin.getAnnouncements);
del("/delete-announcement/:id", { summary: "Remove an announcement", auth: "admin", params: v.idParam("id"), tags: ["Announcements"] }, admin.deleteAnnouncement);

// ---------------------------------------------------------------- rooms

get("/get-rooms", { summary: "Rooms and bookings (with who booked) for a day", auth: "admin", query: RoomsQuery, tags: ["Rooms"] }, features.getRoomsForStaff);
post("/add-room", { summary: "Add a bookable room", auth: "admin", body: RoomBody, tags: ["Rooms"] }, features.addRoom);
post("/update-room/:roomId", { summary: "Rename, resize, describe, open or close a room; closing cancels upcoming bookings and notifies students", auth: "admin", params: v.idParam("roomId"), body: UpdateRoomBody, tags: ["Rooms"] }, features.updateRoom);
post("/remove-room/:roomId", { summary: "Remove a room; upcoming bookings are cancelled and students notified", auth: "admin", params: v.idParam("roomId"), tags: ["Rooms"] }, features.removeRoom);
post("/cancel-room-booking/:bookingId", { summary: "Cancel a student's booking and notify them", auth: "admin", params: v.idParam("bookingId"), body: CancelBookingBody, tags: ["Rooms"] }, features.cancelRoomBookingAsStaff);

export default routes.router;
