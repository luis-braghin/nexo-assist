import { randomUUID } from "node:crypto";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  ChatMessage,
  Conversation,
  Decision,
  Draft,
} from "../shared/domain.js";
import { Store } from "./store.js";
import { TicketService, LegacyUnavailable } from "./ticket-service.js";
import { normalize, priorityFor, resource } from "./policy.js";
import { searchArticles } from "./knowledge.js";
import type { Plan, Planner } from "./planner.js";

const State = Annotation.Root({
  text: Annotation<string>(),
  conversation: Annotation<Conversation>(),
  plan: Annotation<Plan>(),
  result: Annotation<ChatMessage | null>(),
});
export class Engine {
  private locks = new Map<string, Promise<unknown>>();
  private graph;
  constructor(
    readonly store: Store,
    readonly service: TicketService,
    readonly planner: Planner,
  ) {
    this.graph = new StateGraph(State)
      .addNode("interpret", async (s) => ({
        plan: await planner.plan(s.text, s.conversation),
      }))
      .addNode("policy_and_execute", (s) => ({
        result: this.execute(s.conversation, s.text, s.plan),
      }))
      .addEdge(START, "interpret")
      .addEdge("interpret", "policy_and_execute")
      .addEdge("policy_and_execute", END)
      .compile();
  }
  private owned(owner: string, id: string) {
    const c = this.store.conversation(id);
    if (!c || c.ownerId !== owner) throw new Error("Conversa não encontrada");
    return c;
  }
  private save(c: Conversation) {
    c.version++;
    c.updatedAt = new Date().toISOString();
    this.store.putConversation(c);
  }
  async turn(owner: string, id: string, text: string) {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        const c = this.owned(owner, id);
        if (c.status === "closed")
          throw new Error("Conversa encerrada. Inicie outra conversa.");
        this.store.append(id, "user", text);
        if (c.status !== "bot") {
          c.summary = (c.summary + "\n" + text).slice(-3000);
          this.save(c);
          return null;
        }
        const start = performance.now();
        try {
          const result = await this.graph.invoke({ text, conversation: c });
          if (result.result?.decision) {
            result.result.decision.elapsedMs = Math.round(
              performance.now() - start,
            );
            this.store.db
              .prepare("UPDATE messages SET body=? WHERE id=?")
              .run(JSON.stringify(result.result), result.result.id);
          }
          return result.result;
        } catch {
          const latest = this.owned(owner, id);
          if (latest.status !== "bot" || latest.version !== c.version)
            return null;
          return this.handoff(
            latest,
            "Não consegui interpretar o pedido com segurança. Um analista continuará o atendimento.",
            "Falha ou indisponibilidade do interpretador",
          );
        }
      });
    this.locks.set(id, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(id) === task) this.locks.delete(id);
    }
  }
  private answer(
    c: Conversation,
    text: string,
    plan: Plan,
    extra: Partial<ChatMessage> = {},
    action = "Responder",
  ) {
    const decision: Decision = {
      intent: plan.intent,
      confidence: plan.confidence,
      reason: plan.reason.slice(0, 400),
      mode: this.planner.mode,
      elapsedMs: 0,
      steps: [
        {
          action,
          reason:
            "Políticas verificadas no servidor; dados restritos ao funcionário autenticado.",
          evidence: [`Titular: ${c.ownerId}`, `Estado: ${c.status}`],
          confidence: plan.confidence,
        },
      ],
    };
    return this.store.append(c.id, "assistant", text, { decision, ...extra });
  }
  private handoff(c: Conversation, text: string, reason: string, plan?: Plan) {
    c.status = "waiting";
    c.draft = null;
    c.summary = [
      reason,
      c.topic,
      ...this.store
        .messages(c.id)
        .filter((m) => m.role === "user")
        .slice(-5)
        .map((m) => m.text),
    ]
      .join("\n")
      .slice(-3000);
    this.save(c);
    return this.store.append(c.id, "assistant", text, {
      decision: {
        intent: plan?.intent ?? "handoff",
        confidence: plan?.confidence ?? 0,
        reason,
        mode: "policy",
        elapsedMs: 0,
        steps: [
          {
            action: "Encaminhar ao analista",
            reason,
            evidence: ["Agente pausado até devolução pelo suporte"],
            confidence: 1,
          },
        ],
      },
    });
  }
  private execute(
    snapshot: Conversation,
    text: string,
    p: Plan,
  ): ChatMessage | null {
    const c = this.owned(snapshot.ownerId, snapshot.id);
    // An analyst may have taken over while the remote model was running.
    if (c.status !== "bot" || c.version !== snapshot.version) return null;
    const q = normalize(text);
    if (
      /humano|atendente|analista|pessoa do suporte/.test(q) ||
      p.intent === "handoff"
    )
      return this.handoff(
        c,
        "Encaminhei a conversa ao suporte, com o histórico e um resumo. O agente está pausado.",
        "Atendimento humano solicitado",
        p,
      );
    if (
      /salario|ferias|holerite|reembolso|ar.condicionado|limpeza/.test(q) ||
      p.intent === "out_scope"
    )
      return this.answer(
        c,
        "Este canal atende TI. Para esse assunto, procure RH, Financeiro ou Facilities pelo canal interno da sua área.",
        p,
        {},
        "Verificar escopo",
      );
    if (/senha\s*[:=]|token\s*[:=]|codigo de verificacao\s*[:=]/.test(q))
      return this.answer(
        c,
        "Não envie senhas ou códigos de verificação. Descreva o erro sem credenciais; se já compartilhou uma credencial, altere-a pelo canal oficial.",
        p,
        {},
        "Proteger credenciais",
      );
    if (p.intent === "list" || p.intent === "read") {
      let tickets;
      try {
        tickets = p.ticketId
          ? [this.service.read(c.ownerId, p.ticketId)]
          : this.service.list(c.ownerId);
      } catch {
        return this.answer(
          c,
          "Não encontrei esse chamado entre os seus registros. Posso listar seus chamados.",
          p,
          { suggestions: ["Meus chamados"] },
          "Verificar titularidade",
        );
      }
      const overdue = tickets.some((t) => t.overdue);
      if (overdue) {
        const m = this.handoff(
          c,
          "Encontrei chamado com prazo vencido e encaminhei o histórico ao suporte para acompanhamento. O agente está pausado.",
          "Chamado com prazo vencido",
          p,
        );
        m.tickets = tickets;
        this.store.db
          .prepare("UPDATE messages SET body=? WHERE id=?")
          .run(JSON.stringify(m), m.id);
        return m;
      }
      return this.answer(
        c,
        tickets.length
          ? "Estes são seus chamados. Se quiser complementar, informe o número e o novo detalhe."
          : "Você ainda não tem chamados.",
        p,
        { tickets },
        "Consultar chamados",
      );
    }
    if (p.intent === "faq") {
      const found = searchArticles(p.query);
      const vpn = found.find((a) => a.id === "KB-101");
      if (vpn && !p.os)
        return this.answer(
          c,
          "Para orientar sobre o erro da VPN, preciso saber: você usa Windows 10 ou Windows 11?",
          p,
          {
            suggestions: [
              "Como corrigir VPN erro 809 no Windows 10?",
              "Como corrigir VPN erro 809 no Windows 11?",
            ],
          },
          "Verificar aplicabilidade",
        );
      if (vpn && p.os === "Windows 11")
        return this.answer(
          c,
          "O procedimento da base para o erro 809 é exclusivo do Windows 10. Para Windows 11, o suporte precisa investigar. Quantas pessoas são afetadas e existe alternativa para trabalhar?",
          p,
          {
            articles: [{ id: vpn.id, title: vpn.title }],
            suggestions: ["VPN Windows 11: só eu, sem alternativa"],
          },
          "Bloquear orientação incompatível",
        );
      if (!found.length)
        return this.handoff(
          c,
          "Não encontrei uma orientação confiável na base. Vou encaminhar ao suporte.",
          "Base sem cobertura",
          p,
        );
      return this.answer(
        c,
        found.map((a) => a.body).join("\n\n"),
        p,
        { articles: found.map((a) => ({ id: a.id, title: a.title })) },
        "Consultar base de conhecimento",
      );
    }
    if (p.confidence < 0.65)
      return this.handoff(
        c,
        "Não identifiquei o pedido com confiança suficiente. Encaminhei ao suporte para esclarecer e continuar o atendimento.",
        "Baixa confiança na interpretação",
        p,
      );
    if (p.intent === "clarify")
      return this.answer(
        c,
        "Descreva o problema ou a solicitação de TI, quem é afetado e se há alternativa para trabalhar.",
        p,
        {},
        "Pedir esclarecimento",
      );
    c.topic = p.description.slice(-3000);
    let existing;
    try {
      existing = p.ticketId
        ? this.service.read(c.ownerId, p.ticketId)
        : this.service.duplicate(c.ownerId, p.title + " " + p.description);
    } catch {
      return this.answer(
        c,
        "Não encontrei esse chamado entre os seus registros.",
        p,
        {},
        "Verificar titularidade",
      );
    }
    if (existing?.overdue)
      return this.handoff(
        c,
        `O chamado ${existing.id} para esse assunto está com prazo vencido. Encaminhei o contexto ao suporte; o agente está pausado.`,
        "Chamado relacionado com prazo vencido",
        p,
      );
    if (p.intent === "update" && !existing) {
      this.save(c);
      return this.answer(
        c,
        "Qual dos seus chamados deseja complementar? Selecione um número e descreva o novo detalhe.",
        p,
        { tickets: this.service.list(c.ownerId) },
        "Selecionar chamado",
      );
    }
    if (!p.affected || !p.urgency) {
      this.save(c);
      return this.answer(
        c,
        "Antes de preparar o chamado, quantas pessoas são afetadas? Isso impede o trabalho, tem compromisso hoje, existe alternativa ou é sem urgência?",
        p,
        {
          suggestions: [
            "Só eu, sem conseguir trabalhar",
            "Só eu, tenho alternativa",
            "Só eu, sem urgência",
            "Equipe toda parada total",
          ],
        },
        "Coletar impacto e urgência",
      );
    }
    const priority = priorityFor(p.affected, p.urgency, p.type);
    if (priority === "Crítica") {
      this.save(c);
      return this.handoff(
        c,
        "O impacto indica incidente crítico. Encaminhei imediatamente ao plantão, com o contexto. O agente está pausado; o prazo de referência é de uma hora, 24/7.",
        "Incidente crítico: equipe impedida de trabalhar",
        p,
      );
    }
    const recent =
      existing?.status === "Resolvido" &&
      existing.resolvedAt &&
      Date.now() - new Date(existing.resolvedAt).getTime() <= 7 * 86400000;
    if (existing?.status === "Resolvido" && !recent) existing = undefined;
    const draft: Draft = {
      token: randomUUID(),
      operation: existing ? (recent ? "reopen" : "update") : "create",
      ticketId: existing?.id ?? null,
      expectedVersion: existing?.version ?? null,
      title: existing?.title ?? p.title.slice(0, 120),
      description: p.description.slice(0, 3000),
      type: existing?.type ?? p.type,
      category: existing?.category ?? p.category,
      priority,
      affected: p.affected,
      urgency: p.urgency,
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    };
    c.draft = draft;
    this.save(c);
    return this.answer(
      c,
      existing
        ? `Encontrei ${existing.id} para o mesmo assunto. Revise a proposta de ${recent ? "reabertura" : "complemento"}; nada será alterado antes da sua confirmação.`
        : "Preparei o rascunho. Confira os dados abaixo e confirme para registrar; nada foi criado ainda.",
      p,
      { draft, ...(existing ? { tickets: [existing] } : {}) },
      "Preparar rascunho com confirmação",
    );
  }
  confirm(owner: string, id: string, token: string) {
    const c = this.owned(owner, id);
    if (c.status !== "bot")
      throw new Error("O agente está pausado ou a conversa foi encerrada");
    const receipt = this.store.receipt(token);
    if (receipt) {
      if (receipt.ticket.ownerId !== owner)
        throw new Error("Operação não autorizada");
      return receipt.ticket;
    }
    const d = c.draft;
    if (!d || d.token !== token)
      throw new Error("Rascunho inválido ou substituído");
    if (Date.parse(d.expiresAt) < Date.now())
      throw new Error("Rascunho expirado. Solicite uma nova prévia.");
    let ticket;
    try {
      ticket = this.service.apply(owner, d);
    } catch (e) {
      if (e instanceof LegacyUnavailable && e.uncertain) {
        const r = this.store.receipt(token);
        if (r) ticket = r.ticket;
        else
          throw new Error(
            "Resultado incerto: procure um analista antes de repetir.",
          );
      } else throw e;
    }
    c.draft = null;
    c.topic = "";
    this.save(c);
    this.store.append(
      id,
      "assistant",
      `Confirmado: ${ticket.id}. ${d.operation === "create" ? "Chamado registrado" : d.operation === "reopen" ? "Chamado reaberto" : "Complemento registrado"}.`,
      {
        tickets: [ticket],
        decision: {
          intent: d.operation,
          confidence: 1,
          reason: "Confirmação explícita da prévia vigente.",
          mode: "policy",
          elapsedMs: 0,
          steps: [
            {
              action: "Registrar no serviço de chamados",
              reason:
                "Autorização, titularidade, versão e idempotência verificadas.",
              evidence: [`Recibo: ${token}`, `Chamado: ${ticket.id}`],
              confidence: 1,
            },
          ],
        },
      },
    );
    if (ticket.overdue)
      this.handoff(
        c,
        "O chamado está com prazo vencido; encaminhei ao suporte.",
        "Prazo vencido após atualização",
      );
    return ticket;
  }
  cancel(owner: string, id: string) {
    const c = this.owned(owner, id);
    c.draft = null;
    c.topic = "";
    this.save(c);
    this.store.append(
      id,
      "system",
      "Rascunho cancelado. Nenhuma alteração realizada.",
    );
  }
  control(id: string, analyst: string, action: "assume" | "return" | "close") {
    const c = this.store.conversation(id);
    if (!c) throw new Error("Conversa não encontrada");
    if (c.status === "closed") throw new Error("Conversa já encerrada");
    if (c.analystId && c.analystId !== analyst)
      throw new Error("Conversa assumida por outro analista");
    c.status =
      action === "assume" ? "human" : action === "return" ? "bot" : "closed";
    c.analystId = action === "assume" ? analyst : null;
    c.draft = null;
    this.save(c);
    this.store.append(
      id,
      "system",
      action === "assume"
        ? "Um analista assumiu. Agente pausado."
        : action === "return"
          ? "Atendimento devolvido ao agente."
          : "Conversa encerrada pelo suporte.",
    );
    return c;
  }
  reply(id: string, analyst: string, text: string) {
    const c = this.store.conversation(id);
    if (!c || c.status !== "human" || c.analystId !== analyst)
      throw new Error("Assuma esta conversa antes de responder");
    return this.store.append(id, "analyst", text);
  }
}
