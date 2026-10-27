export type Category =
  "Acesso" | "Rede e VPN" | "Hardware" | "Software" | "E-mail" | "Outros";
export type Priority = "Crítica" | "Alta" | "Média" | "Baixa";
export type TicketStatus =
  "Aberto" | "Aguardando analista" | "Aprovado" | "Resolvido";
export type ConversationStatus = "bot" | "waiting" | "human" | "closed";
export interface Employee {
  id: string;
  name: string;
  email: string;
  department: string;
  role: "employee" | "analyst";
}
export interface Ticket {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  type: "INC" | "REQ";
  category: Category;
  priority: Priority;
  affected: number;
  urgency: "blocked" | "today" | "alternative" | "routine";
  status: TicketStatus;
  updatedAt: string;
  resolvedAt: string | null;
  version: number;
  dueAt: string;
  overdue: boolean;
}
export interface TraceStep {
  action: string;
  reason: string;
  evidence: string[];
  confidence: number;
}
export interface Decision {
  intent: string;
  confidence: number;
  reason: string;
  mode: "demo" | "llm" | "policy";
  steps: TraceStep[];
  elapsedMs: number;
}
export interface Draft {
  token: string;
  operation: "create" | "update" | "reopen";
  ticketId: string | null;
  expectedVersion: number | null;
  title: string;
  description: string;
  type: "INC" | "REQ";
  category: Category;
  priority: Priority;
  affected: number;
  urgency: Ticket["urgency"];
  expiresAt: string;
}
export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "analyst" | "system";
  text: string;
  createdAt: string;
  decision?: Decision;
  tickets?: Ticket[];
  draft?: Draft;
  suggestions?: string[];
  articles?: { id: string; title: string }[];
}
export interface Conversation {
  id: string;
  ownerId: string;
  status: ConversationStatus;
  analystId: string | null;
  summary: string;
  topic: string;
  draft: Draft | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface ConversationView {
  conversation: Conversation;
  messages: ChatMessage[];
  tickets: Ticket[];
  employee: Employee;
  remaining: number;
  mode: "demo" | "llm";
}
export interface Article {
  id: string;
  title: string;
  tags: string[];
  body: string;
  os?: "Windows 10" | "Windows 11";
}
export const CATEGORIES: Category[] = [
  "Acesso",
  "Rede e VPN",
  "Hardware",
  "Software",
  "E-mail",
  "Outros",
];
