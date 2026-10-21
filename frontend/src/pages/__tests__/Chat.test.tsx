import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { answer, renderPage } from "@/test/render";
import type { ChatMessage, Conversation } from "@/lib/types";
import Chat from "@/pages/student/Chat";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me" }, admin: null, authType: "student", isLoading: false, login: vi.fn(), logout: vi.fn(), reload: vi.fn() }),
}));

const message = (n: number): ChatMessage => ({
  id: `m${n}`,
  sender: n % 2 ? "kabir" : "me",
  content: `message ${n}`,
  createdAt: new Date(Date.now() - (10 - n) * 60_000).toISOString(),
  status: "read",
});

const conversation: Conversation = {
  otherUser: { id: "kabir", fullname: "Kabir Rao", sport: "chess" },
  lastMessage: "message 4",
  lastMessageStatus: "read",
  lastMessageSender: "me",
  lastMessageCreatedAt: message(4).createdAt,
  unreadCount: 0,
};

describe("Chat", () => {
  it("shows the latest messages and loads earlier ones above them", async () => {
    vi.mocked(api.get).mockImplementation(
      answer({
        "/users/get-conversations": [conversation],
        "/users/get-all-players": [],
        "/users/get-notifications?limit=30": { notifications: [], unread: 0 },
        "/users/get-messages/kabir": { messages: [message(3), message(4)], hasMore: true },
        "/users/get-messages/kabir?before=m3": { messages: [message(1), message(2)], hasMore: false },
      }) as typeof api.get
    );
    renderPage(<Chat />);

    expect(await screen.findByText("message 4")).toBeInTheDocument();
    expect(screen.queryByText("message 1")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /load earlier messages/i }));
    const first = await screen.findByText("message 1");
    expect(first.compareDocumentPosition(screen.getByText("message 3")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: /load earlier messages/i })).not.toBeInTheDocument();
  });
});
