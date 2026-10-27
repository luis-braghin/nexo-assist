import type { Draft, Ticket } from "../shared/domain.js";
import { Store } from "./store.js";
import { projectTicket, sameIssue } from "./policy.js";
export class LegacyUnavailable extends Error {
  constructor(public readonly uncertain = false) {
    super("Serviço de chamados temporariamente indisponível");
  }
}
export class TicketService {
  failNext: "off" | "before" | "after" = "off";
  constructor(readonly store: Store) {}
  list(owner: string) {
    return this.store.tickets(owner);
  }
  read(owner: string, id: string) {
    const t = this.store.ticket(id);
    if (!t || t.ownerId !== owner)
      throw new Error("Chamado não encontrado para este funcionário");
    return t;
  }
  duplicate(owner: string, topic: string) {
    return this.list(owner).find(
      (t) =>
        sameIssue(t.title, topic) &&
        (t.status !== "Resolvido" ||
          (t.resolvedAt !== null &&
            Date.now() - new Date(t.resolvedAt).getTime() <= 7 * 86400000)),
    );
  }
  apply(owner: string, draft: Draft) {
    const receipt = this.store.receipt(draft.token);
    if (receipt) {
      if (receipt.ticket.ownerId !== owner)
        throw new Error("Operação não autorizada");
      return receipt.ticket;
    }
    const fault = this.failNext;
    this.failNext = "off";
    if (fault === "before") throw new LegacyUnavailable();
    const result = this.store.atomic(() => {
      const previous = this.store.receipt(draft.token);
      if (previous) return previous.ticket;
      let ticket: Ticket;
      const now = new Date().toISOString();
      if (draft.operation === "create") {
        if (this.duplicate(owner, draft.title))
          throw new Error(
            "Já existe um chamado para este problema. Gere um novo rascunho de atualização.",
          );
        const number =
          24000 +
          Number(
            this.store.db.prepare("SELECT count(*) AS n FROM tickets").get()
              ?.n ?? 0,
          );
        ticket = projectTicket({
          id: `${draft.type}-${number}`,
          ownerId: owner,
          title: draft.title,
          description: draft.description,
          type: draft.type,
          category: draft.category,
          priority: draft.priority,
          affected: draft.affected,
          urgency: draft.urgency,
          status: "Aberto",
          updatedAt: now,
          resolvedAt: null,
          version: 1,
        });
      } else {
        if (!draft.ticketId) throw new Error("Chamado ausente");
        const old = this.read(owner, draft.ticketId);
        if (old.version !== draft.expectedVersion)
          throw new Error("O chamado mudou. Revise um novo rascunho.");
        if (
          draft.operation === "reopen" &&
          (!old.resolvedAt ||
            Date.now() - new Date(old.resolvedAt).getTime() > 7 * 86400000)
        )
          throw new Error("Prazo de reabertura expirado");
        if (draft.operation === "update" && old.status === "Resolvido")
          throw new Error("Chamado resolvido exige reabertura");
        ticket = projectTicket({
          ...old,
          description: `${old.description}\n\nComplemento: ${draft.description}`,
          affected: draft.affected,
          urgency: draft.urgency,
          priority: draft.priority,
          status: draft.operation === "reopen" ? "Aberto" : old.status,
          resolvedAt: draft.operation === "reopen" ? null : old.resolvedAt,
          updatedAt: now,
          version: old.version + 1,
        });
      }
      this.store.putTicket(ticket);
      this.store.putReceipt(draft.token, ticket, draft.operation);
      return ticket;
    });
    if (fault === "after") throw new LegacyUnavailable(true);
    return result;
  }
}
