// Shapes returned by the Smart SAC API (see /api/docs on the backend). Dates arrive as ISO strings.

export type EquipmentStatus = "available" | "in_use" | "broken";

export interface Game {
  id: string;
  name: string;
}

export interface Holder {
  name: string | null;
  rollNo: string | null;
  phone: string | null;
}

export interface EquipmentItem {
  id: string;
  name: string;
  status: EquipmentStatus;
  games: Game[];
  holder: Holder | null;
  issuedAt: string | null;
  dueAt: string | null;
  overdue: boolean;
}

export interface StudentEquipmentItem extends EquipmentItem {
  reservation: { mine: boolean; until: string } | null;
}

export interface StaffEquipmentItem extends EquipmentItem {
  reservation: { until: string; userId: string; name: string | null; rollNo: string | null } | null;
}

export interface Standing {
  rollNo: string;
  lateReturns: number;
  windowDays: number;
  limit: number;
  graceMinutes: number;
  blocked: boolean;
  reason: "overdue" | "late_returns" | null;
  blockedUntil: string | null;
  message: string | null;
  overdue: { loanId: string; equipmentId: string; equipmentName: string; dueAt: string }[];
}

export interface Loan {
  id: string;
  issuedAt: string;
  dueAt: string;
  returnedAt?: string | null;
  overdue?: boolean;
  late?: boolean;
  equipment: { id: string; name: string };
}

export interface Announcement {
  id: string;
  heading: string;
  content: string;
  footer?: string;
  createdAt: string;
  expireAt?: string;
  createdBy?: { name: string | null; email: string } | null;
}

export interface Paged {
  page: number;
  totalPages: number;
  total: number;
}

export interface StudentProfile {
  id: string;
  fullname: string;
  email: string;
  username: string;
  roll_no: string;
  phone_number: string;
  achievements: string[];
  games: { game: Game; rating: number }[];
}

export interface RoomBookingSummary {
  id: string;
  room: { id: string; name: string };
  startsAt: string;
  endsAt: string;
  purpose: string | null;
}

export interface CurrentStudent {
  userDetails: StudentProfile;
  loans: Loan[];
  standing: Standing;
  reservation: { id: string; name: string; reservedUntil: string } | null;
  roomBookings: RoomBookingSummary[];
}

export interface StaffMember {
  id: string;
  email: string;
  name: string | null;
}

export interface StudentDashboard {
  unreadMessages: number;
  openTickets: number;
  unreadNotifications: number;
  equipment: StudentEquipmentItem[];
  announcements: Announcement[];
  standing: Standing;
}

export interface OverdueLoan {
  loanId: string;
  equipmentId: string;
  equipmentName: string;
  rollNo: string;
  name: string | null;
  phone: string | null;
  issuedAt: string;
  dueAt: string;
  minutesOverdue: number;
}

export interface StaffDashboard {
  counts: { out: number; free: number; reserved: number; broken: number; overdue: number; openTickets: number; total: number };
  overdue: OverdueLoan[];
  announcements: Announcement[];
}

export interface HistoryEntry {
  id: string;
  status: string;
  rollNo: string | null;
  dueAt: string | null;
  changedAt: string;
  student: { name: string; rollNo: string } | null;
  staff: string | null;
  equipment?: { id: string; name: string };
}

export interface StudentSummary {
  rollNo: string;
  student: { id: string; fullname: string; email: string; phone_number: string; roll_no: string } | null;
  standing: Standing;
  activeLoans: Loan[];
  recentLoans: Loan[];
  reservation: { equipmentId: string; equipmentName: string; until: string } | null;
}

export type TicketStatus = "open" | "in_process" | "closed";

export interface TicketEvent {
  id: string;
  type: "created" | "status_changed" | "comment";
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  body: string | null;
  createdAt: string;
  author: { kind: "staff" | "student"; name: string } | null;
}

export interface Ticket {
  id: string;
  kind: "broken" | "request";
  heading: string;
  content: string;
  status: TicketStatus;
  requestedGame: string | null;
  requestedItem: string | null;
  equipment: { id: string; name: string } | null;
  sender?: { id: string; fullname: string; roll_no: string; email: string };
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  events?: TicketEvent[];
  replies?: number;
}

export interface StaffTicketList extends Paged {
  tickets: Ticket[];
  pageSize: number;
  counts: { all: number; open: number; in_process: number; closed: number };
}

export interface RoomBooking {
  id: string;
  startsAt: string;
  endsAt: string;
  mine: boolean;
  purpose?: string | null;
  student?: { id: string; name: string; rollNo: string };
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  description: string | null;
  status: "available" | "maintenance";
  bookings: RoomBooking[];
}

export interface RoomsDay {
  date: string;
  today: string;
  timeZone: string;
  openHour: number;
  closeHour: number;
  daysAhead: number;
  maxHours: number;
  rooms: Room[];
}

export type NotificationType =
  | "reservation_expiring"
  | "reservation_expired"
  | "due_soon"
  | "overdue"
  | "ticket_updated"
  | "ticket_reply"
  | "announcement"
  | "room_booking_soon"
  | "room_booking_cancelled";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Usage {
  days: number;
  from: string;
  to: string;
  gameId: string | null;
  games: Game[];
  totalLoans: number;
  enoughData: boolean;
  minLoans: number;
  hours: { hour: number; averageOut: number }[];
  busiestHour: number | null;
  quietestHour: number | null;
  typicalLoanMinutes: number | null;
}

export interface Player {
  id: string;
  fullname: string;
  games: { game: Game; rating: number }[];
}

export interface Conversation {
  otherUser: { id: string; fullname: string; sport: string | null };
  lastMessage: string;
  lastMessageStatus: string;
  lastMessageSender: string;
  lastMessageCreatedAt: string;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  createdAt: string;
  status: string;
  /** Set on messages shown before the server confirms them */
  pending?: boolean;
}

/** One page of a conversation, oldest first; `hasMore` when earlier messages exist */
export interface ChatMessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface SearchResults {
  equipment: { id: string; name: string; status: EquipmentStatus }[];
  students: { id: string; fullname: string; roll_no: string; email: string }[];
  rooms: { id: string; name: string }[];
  tickets: { id: string; heading: string; status: TicketStatus }[];
}
