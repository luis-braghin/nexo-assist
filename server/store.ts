import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  Conversation,
  Employee,
  Ticket,
} from "../shared/domain.js";
import { projectTicket } from "./policy.js";
type Row = Record<string, string | number | null>;
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY, body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations(id), body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, employee TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS receipts(key TEXT PRIMARY KEY, body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS ticket_owner ON tickets(owner);
   CREATE INDEX IF NOT EXISTS conversation_owner ON conversations(owner);
   CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversation);`);
    if (!this.db.prepare("SELECT id FROM employees LIMIT 1").get()) this.seed();
  }
  private seed() {
    const employees: Employee[] = [
      {
        id: "emp-ana",
        name: "Ana Ribeiro",
        email: "ana@nexo.test",
        department: "Operações",
        role: "employee",
      },
      {
        id: "emp-bruno",
        name: "Bruno Costa",
        email: "bruno@nexo.test",
        department: "Comercial",
        role: "employee",
      },
      {
        id: "emp-carla",
        name: "Carla Lima",
        email: "carla@nexo.test",
        department: "Produto",
        role: "employee",
      },
      {
        id: "support-1",
        name: "Luiza Martins",
        email: "suporte@nexo.test",
        department: "Suporte N1",
        role: "analyst",
      },
    ];
    for (const e of employees)
      this.db
        .prepare("INSERT INTO employees VALUES(?,?)")
        .run(e.id, JSON.stringify(e));
    const ago = (days: number) =>
      new Date(Date.now() - days * 86400000).toISOString();
    const seeds: Omit<Ticket, "dueAt" | "overdue">[] = [
      {
        id: "INC-20311",
        ownerId: "emp-ana",
        title: "Notebook lento após atualização",
        description:
          "A lentidão atrapalha as atividades; consigo usar outra máquina.",
        type: "INC",
        category: "Hardware",
        priority: "Média",
        affected: 1,
        urgency: "alternative",
        status: "Aguardando analista",
        updatedAt: ago(6),
        resolvedAt: null,
        version: 1,
      },
      {
        id: "REQ-10442",
        ownerId: "emp-ana",
        title: "Segundo monitor para home office",
        description:
          "Monitor adicional para análise de relatórios, sem urgência.",
        type: "REQ",
        category: "Hardware",
        priority: "Baixa",
        affected: 1,
        urgency: "routine",
        status: "Aprovado",
        updatedAt: ago(7),
        resolvedAt: null,
        version: 1,
      },
      {
        id: "INC-20150",
        ownerId: "emp-ana",
        title: "Acesso ao SAP bloqueado",
        description: "Bloqueio de acesso ao SAP corrigido pelo suporte.",
        type: "INC",
        category: "Acesso",
        priority: "Alta",
        affected: 1,
        urgency: "blocked",
        status: "Resolvido",
        updatedAt: ago(4),
        resolvedAt: ago(4),
        version: 2,
      },
      {
        id: "INC-20340",
        ownerId: "emp-bruno",
        title: "VPN não conecta",
        description: "Erro de VPN no Windows 11, sem alternativa de acesso.",
        type: "INC",
        category: "Rede e VPN",
        priority: "Alta",
        affected: 1,
        urgency: "blocked",
        status: "Aberto",
        updatedAt: ago(0.02),
        resolvedAt: null,
        version: 1,
      },
      {
        id: "INC-20010",
        ownerId: "emp-carla",
        title: "Impressora sem resposta",
        description: "Erro antigo já resolvido.",
        type: "INC",
        category: "Hardware",
        priority: "Média",
        affected: 1,
        urgency: "alternative",
        status: "Resolvido",
        updatedAt: ago(10),
        resolvedAt: ago(10),
        version: 1,
      },
    ];
    for (const ticket of seeds) this.putTicket(projectTicket(ticket));
  }
  employees() {
    return this.db
      .prepare("SELECT body FROM employees")
      .all()
      .map((r) => JSON.parse(String(r.body)) as Employee);
  }
  employee(id: string) {
    const row = this.db
      .prepare("SELECT body FROM employees WHERE id=?")
      .get(id);
    return row ? (JSON.parse(String(row.body)) as Employee) : undefined;
  }
  tickets(owner: string, now = new Date()) {
    return this.db
      .prepare("SELECT body FROM tickets WHERE owner=? ORDER BY id DESC")
      .all(owner)
      .map((r) => projectTicket(JSON.parse(String(r.body)) as Ticket, now));
  }
  ticket(id: string) {
    const r = this.db.prepare("SELECT body FROM tickets WHERE id=?").get(id);
    return r ? projectTicket(JSON.parse(String(r.body)) as Ticket) : undefined;
  }
  putTicket(t: Ticket) {
    this.db
      .prepare(
        "INSERT INTO tickets VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(t.id, t.ownerId, JSON.stringify(t));
  }
  conversations(owner?: string) {
    return (
      owner
        ? this.db
            .prepare("SELECT body FROM conversations WHERE owner=?")
            .all(owner)
        : this.db.prepare("SELECT body FROM conversations").all()
    )
      .map((r) => JSON.parse(String(r.body)) as Conversation)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  conversation(id: string) {
    const r = this.db
      .prepare("SELECT body FROM conversations WHERE id=?")
      .get(id);
    return r ? (JSON.parse(String(r.body)) as Conversation) : undefined;
  }
  putConversation(c: Conversation) {
    this.db
      .prepare(
        "INSERT INTO conversations VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(c.id, c.ownerId, JSON.stringify(c));
  }
  createConversation(owner: string) {
    const now = new Date().toISOString();
    const c: Conversation = {
      id: randomUUID(),
      ownerId: owner,
      status: "bot",
      analystId: null,
      summary: "",
      topic: "",
      draft: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.putConversation(c);
    return c;
  }
  messages(id: string) {
    return this.db
      .prepare("SELECT body FROM messages WHERE conversation=? ORDER BY rowid")
      .all(id)
      .map((r) => JSON.parse(String(r.body)) as ChatMessage);
  }
  append(
    id: string,
    role: ChatMessage["role"],
    text: string,
    extra: Partial<ChatMessage> = {},
  ) {
    const m: ChatMessage = {
      id: randomUUID(),
      conversationId: id,
      role,
      text,
      createdAt: new Date().toISOString(),
      ...extra,
    };
    this.db
      .prepare("INSERT INTO messages VALUES(?,?,?)")
      .run(m.id, id, JSON.stringify(m));
    return m;
  }
  createSession(employee: string) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO sessions(id,employee,expires) VALUES(?,?,?)")
      .run(id, employee, Date.now() + 86400000);
    return id;
  }
  session(id: string) {
    const r = this.db
      .prepare("SELECT * FROM sessions WHERE id=? AND expires>?")
      .get(id, Date.now()) as Row | undefined;
    return r
      ? {
          id: String(r.id),
          employee: String(r.employee),
          count: Number(r.count),
        }
      : undefined;
  }
  consumeMessage(id: string) {
    const r = this.db
      .prepare(
        "UPDATE sessions SET count=count+1 WHERE id=? AND count<30 AND expires>? RETURNING count",
      )
      .get(id, Date.now());
    return r ? Number(r.count) : null;
  }
  deleteSession(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
  }
  receipt(key: string) {
    const r = this.db.prepare("SELECT body FROM receipts WHERE key=?").get(key);
    return r
      ? (JSON.parse(String(r.body)) as { ticket: Ticket; operation: string })
      : undefined;
  }
  putReceipt(key: string, ticket: Ticket, operation: string) {
    this.db
      .prepare("INSERT INTO receipts VALUES(?,?)")
      .run(key, JSON.stringify({ ticket, operation }));
  }
  atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
