import type { Priority, Ticket } from "../shared/domain.js";
export function priorityFor(
  affected: number,
  urgency: Ticket["urgency"],
  type: Ticket["type"],
): Priority {
  if (type === "INC" && affected > 1 && urgency === "blocked") return "Crítica";
  if (urgency === "blocked" || urgency === "today") return "Alta";
  if (urgency === "alternative") return "Média";
  return "Baixa";
}
function businessMinute(date: Date) {
  const local = new Date(date.getTime() - 3 * 3600000);
  return (
    local.getUTCDay() > 0 &&
    local.getUTCDay() < 6 &&
    local.getUTCHours() >= 8 &&
    local.getUTCHours() < 18
  );
}
export function deadline(updatedAt: string, priority: Priority): string {
  const start = new Date(updatedAt);
  if (!Number.isFinite(start.getTime())) throw new Error("Data inválida");
  if (priority === "Crítica")
    return new Date(start.getTime() + 3600000).toISOString();
  const minutes: Record<Exclude<Priority, "Crítica">, number> = {
    Alta: 240,
    Média: 1800,
    Baixa: 3000,
  };
  let left = minutes[priority];
  const cursor = new Date(start);
  while (left > 0) {
    if (businessMinute(cursor)) left--;
    cursor.setTime(cursor.getTime() + 60000);
  }
  return cursor.toISOString();
}
export function projectTicket(
  ticket: Omit<Ticket, "dueAt" | "overdue">,
  now = new Date(),
): Ticket {
  const dueAt = deadline(ticket.updatedAt, ticket.priority);
  return {
    ...ticket,
    dueAt,
    overdue:
      ticket.status !== "Resolvido" &&
      new Date(dueAt).getTime() < now.getTime(),
  };
}
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
export function resource(text: string): string | null {
  const s = normalize(text);
  for (const [key, re] of Object.entries({
    vpn: /vpn/,
    sap: /sap/,
    email: /outlook|e-mail|email|correio/,
    notebook: /notebook|computador|laptop/,
    impressora: /impressor/,
    monitor: /monitor/,
    wifi: /wi-?fi|internet|rede/,
  }))
    if (re.test(s)) return key;
  return null;
}
export function sameIssue(title: string, description: string): boolean {
  const a = resource(title),
    b = resource(description);
  return a !== null && a === b;
}
