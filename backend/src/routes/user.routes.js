import { z } from "../lib/zod.js";
import { createRoutes } from "../lib/route.js";
import { authLimiter, rateLimit } from "../middlewares/rateLimit.middleware.js";
import * as v from "../validation/common.js";
import * as user from "../controllers/user.controller.js";
import * as features from "../controllers/features.controller.js";
import { MESSAGES_PAGE_SIZE, MESSAGES_PER_MINUTE, MINUTE, ROOM_MAX_HOURS_PER_BOOKING } from "../config/policy.js";

const routes = createRoutes({ prefix: "/users", tag: "Students" });
const { get, post } = routes;

// Counted per student (these routes run auth first), so classmates on one campus address don't share a count
const deleteAccountLimiter = rateLimit({ windowMs: 15 * MINUTE, max: 10, keyBy: (req) => req.user.id });
const messageLimiter = rateLimit({ windowMs: MINUTE, max: MESSAGES_PER_MINUTE, keyBy: (req) => req.user.id });

// ---------------------------------------------------------------- schemas

const RegisterBody = z
  .object({
    fullname: v.shortText("Full name", 80),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "Usernames are at least 3 characters")
      .max(30, "Usernames are at most 30 characters")
      .regex(/^[a-z0-9_.]+$/, "Use only letters, numbers, dots and underscores"),
    email: v.iiitaEmail,
    phone_number: v.phone,
    roll_no: v.rollNo,
    password: v.password,
  })
  .superRefine((b, ctx) => {
    // The roll number can't be changed later and loans follow it, so it must come from the student's own email
    if (typeof b.email !== "string") return;
    const fromEmail = v.rollNoFromEmail(b.email);
    if (!fromEmail) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "Use your student email, your roll number @iiita.ac.in" });
    } else if (typeof b.roll_no === "string" && b.roll_no !== fromEmail) {
      ctx.addIssue({ code: "custom", path: ["roll_no"], message: `Your email says your roll number is ${fromEmail}` });
    }
  });

const EmailBody = z.object({ email: v.email });
const EmailCodeBody = z.object({ email: v.email, token: v.otp });

const LoginBody = z.object({
  // Either the account email or the username
  email: z.string().trim().toLowerCase().min(1, "Enter your email or username"),
  password: z.string().min(1, "Enter your password"),
});

const ChangePasswordBody = z.object({
  oldPassword: z.string().min(1, "Enter your current password"),
  newPassword: v.password,
});

const DeleteAccountBody = z.object({ password: z.string().min(1, "Enter your password") });

const ResetPasswordBody = z
  .object({ email: v.email, token: v.otp, newPassword: v.password, confirmPassword: z.string() })
  .refine((b) => b.newPassword === b.confirmPassword, { path: ["confirmPassword"], message: "The passwords don't match" });

// No roll number: it's fixed at sign-up because loans and borrowing blocks are kept by it
const UpdateProfileBody = z
  .object({
    fullname: v.shortText("Full name", 80).optional(),
    phone_number: v.phone.optional(),
    achievements: z.array(v.shortText("Achievement", 140)).max(20, "Keep it to 20 achievements").optional(),
    games: z
      .array(z.object({ game: v.id, rating: z.number().int().min(0, "Ratings go from 0 to 5").max(5, "Ratings go from 0 to 5") }))
      .max(20)
      .optional(),
  })
  .refine((b) => Object.values(b).some((value) => value !== undefined), { message: "Change at least one field" });

const EquipmentIdBody = z.object({ equipmentId: v.id });

const UsageQuery = z.object({
  days: z.coerce.number().int().refine((d) => [7, 14, 28, 56].includes(d), "Pick 7, 14, 28 or 56 days").default(28),
  gameId: v.id.optional(),
});

const MessagesQuery = z.object({
  // The oldest message already shown; the page holds the ones sent before it
  before: v.id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(MESSAGES_PAGE_SIZE),
});

const SendMessageBody = z.object({
  receiverId: v.id,
  content: v.longText("Message", 2000),
});

const BrokenTicketBody = z.object({
  equipmentId: v.id,
  heading: v.shortText("What's wrong", 120),
  content: v.longText("Details", 2000),
});

const RequestTicketBody = z.object({
  game: v.shortText("Game", 60),
  equipment: v.shortText("Equipment", 80),
  heading: v.shortText("Why it's needed", 120),
  details: v.longText("Details", 2000),
});

const CommentBody = z.object({ body: v.longText("Reply", 2000) });

const NotificationsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
const MarkReadBody = z.object({ ids: z.array(v.id).max(200).optional() });

const RoomsQuery = z.object({ date: v.dateKey.optional() });
const BookRoomBody = z.object({
  roomId: v.id,
  startsAt: z.string().datetime({ offset: true, message: "startsAt must be an ISO date-time" }),
  hours: z.coerce
    .number()
    .int()
    .min(1, "Book at least one hour")
    .max(ROOM_MAX_HOURS_PER_BOOKING, `Book at most ${ROOM_MAX_HOURS_PER_BOOKING} hours`),
  purpose: z.string().trim().max(120, "Keep the purpose under 120 characters").optional(),
});

const PageQuery = z.object({ page: v.page });

// ---------------------------------------------------------------- account

post("/register", { summary: "Create a student account and email a verification code", limiter: authLimiter, body: RegisterBody, tags: ["Auth"] }, user.registerUser);
post("/verify-email", { summary: "Confirm an email address with its 6-digit code", limiter: authLimiter, body: EmailCodeBody, tags: ["Auth"] }, user.verifyEmail);
post("/resend-verification-email", { summary: "Send a new verification code", limiter: authLimiter, body: EmailBody, tags: ["Auth"] }, user.resendVerificationEmail);
post("/login", { summary: "Sign in with email or username; sets the session cookies", limiter: authLimiter, body: LoginBody, tags: ["Auth"] }, user.loginUser);
post("/logout", { summary: "Sign out and revoke the refresh token", auth: "user", tags: ["Auth"] }, user.logoutUser);
post("/refresh-token", { summary: "Rotate the session cookies using the refresh-token cookie", tags: ["Auth"] }, user.refreshAccessToken);
post("/change-password", { summary: "Change the signed-in student's password", auth: "user", body: ChangePasswordBody, tags: ["Auth"] }, user.changeCurrentPassword);
post("/forgot-password", { summary: "Email a password reset code", limiter: authLimiter, body: EmailBody, tags: ["Auth"] }, user.forgotPassword);
post("/verify-reset-token", { summary: "Check a password reset code before choosing a new password", limiter: authLimiter, body: EmailCodeBody, tags: ["Auth"] }, user.verifyResetToken);
post("/reset-password", { summary: "Set a new password with a reset code", limiter: authLimiter, body: ResetPasswordBody, tags: ["Auth"] }, user.resetPassword);

get("/current-user", { summary: "The signed-in student with their loans, standing, hold and room bookings", auth: "user" }, user.getCurrentUser);
post("/update-account-details", { summary: "Update profile fields and game ratings", auth: "user", body: UpdateProfileBody }, user.updateAccountDetails);
post("/delete-account", { summary: "Delete the signed-in student's account (needs the password; nothing may be out)", auth: "user", limiter: deleteAccountLimiter, body: DeleteAccountBody, tags: ["Auth"] }, user.deleteAccount);

// ---------------------------------------------------------------- dashboard and equipment

get("/dashboard", { summary: "Equipment rack, counts, standing and latest announcements", auth: "user" }, user.dashboardDetails);
post("/reserve-equipment", { summary: "Hold a free item for 15 minutes (one at a time)", auth: "user", body: EquipmentIdBody, tags: ["Equipment"] }, features.reserveEquipment);
post("/cancel-reservation", { summary: "Cancel your hold on an item", auth: "user", body: EquipmentIdBody, tags: ["Equipment"] }, features.cancelReservation);
get("/get-usage", { summary: "Average items out per hour over recent days, from real checkouts", auth: "user", query: UsageQuery, tags: ["Equipment"] }, features.getUsageStats);

// ---------------------------------------------------------------- players and chat

get("/get-all-players", { summary: "Other students and the games they play", auth: "user", tags: ["Chat"] }, user.getAllPlayers);
get("/get-games", { summary: "Games offered at the SAC", auth: "user" }, user.getGames);
post("/send-message", { summary: "Send a chat message", auth: "user", limiter: messageLimiter, body: SendMessageBody, tags: ["Chat"] }, user.sendMessage);
get("/get-conversations", { summary: "Latest message and unread count per conversation", auth: "user", tags: ["Chat"] }, user.getConversations);
get("/get-messages/:otherUserId", { summary: "A page of a conversation, newest last; marks the other student's messages read", auth: "user", params: v.idParam("otherUserId"), query: MessagesQuery, tags: ["Chat"] }, user.getMessages);

// ---------------------------------------------------------------- tickets

post("/create-ticket", { summary: "Report broken equipment", auth: "user", body: BrokenTicketBody, tags: ["Tickets"] }, features.createBrokenTicket);
post("/request-new-equipment", { summary: "Ask the SAC for new equipment", auth: "user", body: RequestTicketBody, tags: ["Tickets"] }, features.createRequestTicket);
get("/get-my-tickets", { summary: "Tickets this student opened", auth: "user", tags: ["Tickets"] }, features.getMyTickets);
get("/get-ticket/:ticketId", { summary: "One of this student's tickets with its timeline", auth: "user", params: v.idParam("ticketId"), tags: ["Tickets"] }, features.getMyTicket);
post("/add-ticket-comment/:ticketId", { summary: "Reply on your ticket", auth: "user", params: v.idParam("ticketId"), body: CommentBody, tags: ["Tickets"] }, features.commentAsStudent);

// ---------------------------------------------------------------- rooms

get("/get-rooms", { summary: "Rooms and their bookings for a day (defaults to today)", auth: "user", query: RoomsQuery, tags: ["Rooms"] }, features.getRoomsForStudent);
get("/get-my-room-bookings", { summary: "This student's upcoming room bookings", auth: "user", tags: ["Rooms"] }, features.getMyRoomBookings);
post("/book-room", { summary: "Book a room for whole-hour slots", auth: "user", body: BookRoomBody, tags: ["Rooms"] }, features.bookRoom);
post("/cancel-room-booking/:bookingId", { summary: "Cancel your room booking", auth: "user", params: v.idParam("bookingId"), tags: ["Rooms"] }, features.cancelMyRoomBooking);

// ---------------------------------------------------------------- notifications and announcements

get("/get-notifications", { summary: "Recent notifications and the unread count", auth: "user", query: NotificationsQuery, tags: ["Notifications"] }, features.getNotifications);
post("/mark-notifications-read", { summary: "Mark some (ids) or all notifications read", auth: "user", body: MarkReadBody, tags: ["Notifications"] }, features.markNotificationsRead);
get("/get-announcements", { summary: "Announcements, newest first (public)", query: PageQuery, tags: ["Announcements"] }, user.getPublicAnnouncements);

export default routes.router;
