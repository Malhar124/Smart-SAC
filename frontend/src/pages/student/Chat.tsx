import Navbar from "@/components/Navbar";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Send, Plus, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { qk } from "@/lib/queryKeys";
import type { ChatMessage, Conversation, Player } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";

type ApiConversation = Conversation;

const PersonRow = ({
  name,
  detail,
  meta,
  unread = 0,
  selected,
  onSelect,
}: {
  name: string;
  detail: ReactNode;
  meta?: string;
  unread?: number;
  selected: boolean;
  onSelect: () => void;
}) => (
  <li>
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full text-left px-4 py-3 border-l-[3px] transition-colors hover:bg-accent focus-visible:outline-offset-[-2px]",
        selected ? "border-primary bg-accent" : "border-transparent"
      )}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className={cn("truncate", unread > 0 ? "font-semibold" : "font-medium")}>{name}</span>
        {meta && <span className="text-xs text-muted-foreground shrink-0">{meta}</span>}
      </span>
      <span className="mt-0.5 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground truncate">{detail}</span>
        {unread > 0 && (
          <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold tabular grid place-items-center">
            {unread}
            <span className="sr-only"> unread</span>
          </span>
        )}
      </span>
    </button>
  </li>
);

const ListNote = ({ children }: { children: ReactNode }) => (
  <p className="px-4 pt-4 pb-1 text-sm text-muted-foreground">{children}</p>
);

const Chat = () => {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  // Phones show either the list or the open thread; this tracks which
  const [threadOpen, setThreadOpen] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLLIElement>(null);

  const { data: conversations, isLoading: isLoadingConversations } = useQuery({
    queryKey: qk.conversations,
    queryFn: () => api.get<ApiConversation[]>("/users/get-conversations"),
  });

  // Every registered student, for starting new conversations
  const { data: allPlayers, isLoading: isLoadingPlayers } = useQuery({
    queryKey: qk.players,
    queryFn: () => api.get<Player[]>("/users/get-all-players"),
  });

  // Opening a thread marks it read on the server, which pushes a live update that refreshes badges
  const { data: messages, isLoading: isLoadingMessages } = useQuery({
    queryKey: qk.messages(selectedChatId ?? ""),
    queryFn: () => api.get<ChatMessage[]>(`/users/get-messages/${selectedChatId}`),
    enabled: !!selectedChatId,
  });

  // The message appears in the thread at once, marked as sending, and is swapped for the saved one
  const sendMessageMutation = useMutation({
    mutationFn: (variables: { receiverId: string; content: string }) => api.post<ChatMessage>("/users/send-message", variables),
    onMutate: async (variables) => {
      const key = qk.messages(variables.receiverId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatMessage[]>(key);
      const optimistic: ChatMessage = {
        id: `pending-${Date.now()}`,
        sender: user?.id ?? "",
        content: variables.content,
        createdAt: new Date().toISOString(),
        status: "sent",
        pending: true,
      };
      queryClient.setQueryData<ChatMessage[]>(key, [...(previous ?? []), optimistic]);
      setMessage("");
      setShowNewChat(false);
      return { previous, key, content: variables.content };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(context.key, context.previous);
        setMessage(context.content);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: qk.messages(variables.receiverId) });
      queryClient.invalidateQueries({ queryKey: qk.conversations });
    },
  });

  const handleSend = () => {
    if (message.trim() && selectedChatId) {
      sendMessageMutation.mutate({ receiverId: selectedChatId, content: message.trim() });
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openThread = (id: string) => {
    setSelectedChatId(id);
    setThreadOpen(true);
  };

  const selectedChat = conversations?.find((c) => c.otherUser.id === selectedChatId);

  // Find the selected player from allPlayers if not in conversations (new chat)
  const selectedPlayer = allPlayers?.find((p) => p.id === selectedChatId);

  // Auto-select first conversation only if not in new-chat mode
  if (!selectedChatId && !showNewChat && conversations && conversations.length > 0) {
    setSelectedChatId(conversations[0].otherUser.id);
  }

  // Filter users who don't have existing conversations (for new chat list)
  const existingConversationIds = new Set(conversations?.map((c) => c.otherUser.id) || []);
  const newChatUsers = allPlayers?.filter((p) => !existingConversationIds.has(p.id)) || [];

  // Filter based on search
  const filteredConversations = conversations?.filter((c) =>
    c.otherUser.fullname.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredNewChatUsers = newChatUsers.filter((p) =>
    p.fullname.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleStartNewChat = (playerId: string) => {
    openThread(playerId);
    setShowNewChat(false);
  };

  // Determine the name/sport for chat header
  const chatHeaderName = selectedChat?.otherUser.fullname || selectedPlayer?.fullname || "";
  const chatHeaderSport = selectedChat?.otherUser.sport || 
    (selectedPlayer?.games?.map(g => g.game.name).join(", ") || "");

  const timeAgo = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });

  const hasThread = !!selectedChatId && !!(selectedChat || selectedPlayer);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <PageHeader title="Chat" compact />

      <main id="main" tabIndex={-1} className="focus:outline-none container mx-auto max-w-6xl px-4 md:px-6 pt-8 pb-6">

        <div className="grid lg:grid-cols-[20rem_minmax(0,1fr)] border border-border rounded-lg bg-card h-[calc(100dvh-13.5rem)] min-h-[26rem] overflow-hidden">
          {/* Conversation list */}
          <section
            aria-label={showNewChat ? "Start a conversation" : "Conversations"}
            className={cn("flex flex-col min-h-0 lg:border-r border-border", threadOpen && "hidden lg:flex")}
          >
            <div className="flex items-center gap-2 p-3 border-b border-border">
              {showNewChat && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setShowNewChat(false)}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft />
                </Button>
              )}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  type="search"
                  placeholder={showNewChat ? "Search students" : "Search chats"}
                  aria-label={showNewChat ? "Search students" : "Search chats"}
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              {!showNewChat && (
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={() => {
                    setShowNewChat(true);
                    setSearchQuery("");
                  }}
                  aria-label="New conversation"
                  title="New conversation"
                >
                  <Plus />
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {showNewChat ? (
                <>
                  <ListNote>Pick someone to message.</ListNote>
                  {isLoadingPlayers ? (
                    <div className="p-4 space-y-3">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : filteredNewChatUsers.length === 0 ? (
                    <p className="px-4 py-2 text-sm text-muted-foreground">
                      {searchQuery ? "No one matches that name." : "You've already got a chat with everyone."}
                    </p>
                  ) : (
                    <ul>
                      {filteredNewChatUsers.map((player) => (
                        <PersonRow
                          key={player.id}
                          selected={selectedChatId === player.id}
                          name={player.fullname}
                          detail={<span className="capitalize">{player.games?.map((g) => g.game.name).join(", ") || "No games added"}</span>}
                          onSelect={() => handleStartNewChat(player.id)}
                        />
                      ))}
                    </ul>
                  )}
                </>
              ) : isLoadingConversations ? (
                <div className="p-4 space-y-3" aria-label="Loading chats">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !filteredConversations || filteredConversations.length === 0 ? (
                <div className="p-6">
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? "No chats match that name." : "No chats yet. Message someone to plan a game."}
                  </p>
                  {!searchQuery && (
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowNewChat(true)}>
                      Start a chat
                    </Button>
                  )}
                </div>
              ) : (
                <ul>
                  {filteredConversations.map((conv) => (
                    <PersonRow
                      key={conv.otherUser.id}
                      selected={selectedChatId === conv.otherUser.id}
                      name={conv.otherUser.fullname}
                      meta={timeAgo(conv.lastMessageCreatedAt)}
                      unread={conv.unreadCount}
                      detail={
                        <>
                          {conv.lastMessageSender === user?.id ? "You: " : ""}
                          {conv.lastMessage}
                        </>
                      }
                      onSelect={() => openThread(conv.otherUser.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Open thread */}
          <section
            aria-label={hasThread ? `Chat with ${chatHeaderName}` : "No chat open"}
            className={cn("flex flex-col min-h-0", !threadOpen && "hidden lg:flex")}
          >
            {hasThread ? (
              <>
                <div className="flex items-center gap-2 px-3 py-3 border-b border-border min-h-[4.0625rem]">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden shrink-0"
                    onClick={() => setThreadOpen(false)}
                    aria-label="Back to chats"
                  >
                    <ArrowLeft />
                  </Button>
                  <div className="min-w-0 lg:pl-1">
                    <h2 className="font-semibold truncate">{chatHeaderName}</h2>
                    {chatHeaderSport && (
                      <p className="text-sm text-muted-foreground capitalize truncate">{chatHeaderSport}</p>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 bg-background" aria-live="polite">
                  {isLoadingMessages ? (
                    <div className="space-y-3">
                      <Skeleton className="h-10 w-1/2" />
                      <Skeleton className="h-10 w-1/3 ml-auto" />
                    </div>
                  ) : !messages || messages.length === 0 ? (
                    <p className="h-full grid place-items-center text-sm text-muted-foreground text-center">
                      No messages yet. Say hi and suggest a time to play.
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-2">
                      {messages.map((msg, index) => {
                        const isSent = String(msg.sender) === String(user?.id);
                        const lastSent = isSent && !messages.slice(index + 1).some((m) => m.sender === msg.sender);
                        return (
                          <li key={msg.id} className={cn("flex flex-col max-w-[80%] sm:max-w-[65%]", isSent ? "self-end items-end" : "self-start items-start")}>
                            <p
                              className={cn(
                                "px-3 py-2 rounded-lg text-sm leading-snug break-words whitespace-pre-line",
                                isSent ? "bg-primary text-primary-foreground" : "bg-card border border-border",
                                msg.pending && "opacity-60"
                              )}
                            >
                              {msg.content}
                            </p>
                            <span className="mt-1 text-xs text-muted-foreground">
                              {msg.pending ? (
                                "Sending…"
                              ) : (
                                <>
                                  <time dateTime={msg.createdAt}>{timeAgo(msg.createdAt)}</time>
                                  {lastSent && msg.status === "read" && <span>, read</span>}
                                </>
                              )}
                            </span>
                          </li>
                        );
                      })}
                      <li ref={messagesEndRef} aria-hidden />
                    </ol>
                  )}
                </div>

                <form
                  className="flex items-center gap-2 p-3 border-t border-border"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                  }}
                >
                  <Input
                    type="text"
                    placeholder={`Message ${chatHeaderName.split(" ")[0]}`}
                    aria-label="Message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="flex-1"
                    maxLength={2000}
                  />
                  <Button type="submit" disabled={!message.trim()}>
                    <Send />
                    <span className="sr-only sm:not-sr-only">Send</span>
                  </Button>
                </form>
              </>
            ) : (
              <div className="flex-1 grid place-items-center p-6 text-center">
                <div>
                  <p className="text-muted-foreground">Pick a chat, or start one with someone you'd like to play with.</p>
                  <Button variant="outline" className="mt-4" onClick={() => setShowNewChat(true)}>
                    Start a chat
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default Chat;
