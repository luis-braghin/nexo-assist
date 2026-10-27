import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { TicketService, LegacyUnavailable } from "../server/ticket-service.js";
import { Engine } from "../server/engine.js";
import { DemoPlanner, type Planner, type Plan } from "../server/planner.js";
import { deadline, priorityFor } from "../server/policy.js";
import { createApp } from "../server/app.js";
const fixture = () => {
  const store = new Store(":memory:");
  const service = new TicketService(store);
  const engine = new Engine(store, service, new DemoPlanner());
  return { store, service, engine, c: store.createConversation("emp-ana") };
};
function freshNotebook(f: ReturnType<typeof fixture>) {
  f.store.putTicket({
    ...f.service.read("emp-ana", "INC-20311"),
    updatedAt: new Date().toISOString(),
  });
}
const problem = "VPN Windows 11 não conecta, só eu, sem conseguir trabalhar";
test("prioridade depende de impacto, urgência e tipo", () => {
  assert.equal(priorityFor(20, "blocked", "INC"), "Crítica");
  assert.equal(priorityFor(1, "blocked", "INC"), "Alta");
  assert.equal(priorityFor(1, "alternative", "INC"), "Média");
  assert.equal(priorityFor(1, "routine", "REQ"), "Baixa");
});
test("SLA alto atravessa fim de semana no horário de Brasília", () => {
  assert.equal(
    deadline("2026-10-23T20:00:00.000Z", "Alta"),
    "2026-10-26T14:00:00.000Z",
  );
  assert.equal(
    deadline("2026-10-24T20:00:00.000Z", "Crítica"),
    "2026-10-24T21:00:00.000Z",
  );
});
test("prévia não cria e confirmação repetida tem um único efeito", async () => {
  const f = fixture();
  try {
    await f.engine.turn("emp-ana", f.c.id, problem);
    const d = f.store.conversation(f.c.id)!.draft!;
    assert.ok(d);
    assert.equal(f.store.tickets("emp-ana").length, 3);
    const t = f.engine.confirm("emp-ana", f.c.id, d.token);
    assert.equal(f.store.tickets("emp-ana").length, 4);
    assert.equal(f.engine.confirm("emp-ana", f.c.id, d.token).id, t.id);
    assert.equal(f.store.tickets("emp-ana").length, 4);
  } finally {
    f.store.close();
  }
});
test("titularidade bloqueia leitura, chat e confirmação de outro funcionário", async () => {
  const f = fixture();
  try {
    assert.throws(() => f.service.read("emp-ana", "INC-20340"));
    await assert.rejects(f.engine.turn("emp-bruno", f.c.id, problem));
    await f.engine.turn("emp-ana", f.c.id, problem);
    assert.throws(() =>
      f.engine.confirm(
        "emp-bruno",
        f.c.id,
        f.store.conversation(f.c.id)!.draft!.token,
      ),
    );
  } finally {
    f.store.close();
  }
});
test("prévia expirada ou substituída não pode executar", async () => {
  const f = fixture();
  try {
    await f.engine.turn("emp-ana", f.c.id, problem);
    const c = f.store.conversation(f.c.id)!;
    const token = c.draft!.token;
    c.draft!.expiresAt = new Date(0).toISOString();
    f.store.putConversation(c);
    assert.throws(() => f.engine.confirm("emp-ana", c.id, token), /expirado/);
    f.engine.cancel("emp-ana", c.id);
    assert.throws(() => f.engine.confirm("emp-ana", c.id, token));
    assert.equal(f.store.tickets("emp-ana").length, 3);
  } finally {
    f.store.close();
  }
});
test("chamado aberto do mesmo assunto vira complemento", async () => {
  const f = fixture();
  try {
    freshNotebook(f);
    await f.engine.turn(
      "emp-ana",
      f.c.id,
      "Notebook lento, só eu, tenho alternativa",
    );
    assert.equal(f.store.conversation(f.c.id)!.draft!.operation, "update");
    assert.equal(f.store.conversation(f.c.id)!.draft!.ticketId, "INC-20311");
  } finally {
    f.store.close();
  }
});
test("resolvido há quatro dias exige confirmação de reabertura", async () => {
  const f = fixture();
  try {
    await f.engine.turn(
      "emp-ana",
      f.c.id,
      "SAP bloqueado voltou, só eu, sem conseguir trabalhar",
    );
    const d = f.store.conversation(f.c.id)!.draft!;
    assert.equal(d.operation, "reopen");
    const t = f.engine.confirm("emp-ana", f.c.id, d.token);
    assert.equal(t.status, "Aberto");
    assert.equal(t.resolvedAt, null);
  } finally {
    f.store.close();
  }
});
test("resolvido há mais de sete dias gera novo registro", async () => {
  const f = fixture();
  try {
    const c = f.store.createConversation("emp-carla");
    await f.engine.turn(
      "emp-carla",
      c.id,
      "Impressora parou, só eu, tenho alternativa",
    );
    assert.equal(f.store.conversation(c.id)!.draft!.operation, "create");
  } finally {
    f.store.close();
  }
});
test("versão alterada exige nova revisão", async () => {
  const f = fixture();
  try {
    freshNotebook(f);
    await f.engine.turn(
      "emp-ana",
      f.c.id,
      "Notebook lento, só eu, tenho alternativa",
    );
    const d = f.store.conversation(f.c.id)!.draft!,
      t = f.service.read("emp-ana", d.ticketId!);
    f.store.putTicket({ ...t, version: t.version + 1 });
    assert.throws(() => f.engine.confirm("emp-ana", f.c.id, d.token), /mudou/);
  } finally {
    f.store.close();
  }
});
test("falha antes de gravar preserva prévia e não cria chamado", async () => {
  const f = fixture();
  try {
    await f.engine.turn("emp-ana", f.c.id, problem);
    const d = f.store.conversation(f.c.id)!.draft!;
    f.service.failNext = "before";
    assert.throws(
      () => f.engine.confirm("emp-ana", f.c.id, d.token),
      LegacyUnavailable,
    );
    assert.equal(f.store.tickets("emp-ana").length, 3);
    assert.ok(f.store.conversation(f.c.id)!.draft);
    f.engine.confirm("emp-ana", f.c.id, d.token);
    assert.equal(f.store.tickets("emp-ana").length, 4);
  } finally {
    f.store.close();
  }
});
test("falha após commit reconcilia recibo sem repetir gravação", async () => {
  const f = fixture();
  try {
    await f.engine.turn("emp-ana", f.c.id, problem);
    const d = f.store.conversation(f.c.id)!.draft!;
    f.service.failNext = "after";
    const t = f.engine.confirm("emp-ana", f.c.id, d.token);
    assert.equal(t.version, 1);
    assert.equal(f.store.tickets("emp-ana").length, 4);
    assert.equal(f.store.conversation(f.c.id)!.draft, null);
  } finally {
    f.store.close();
  }
});
test("VPN Windows 11 não recebe procedimento incompatível do Windows 10", async () => {
  const f = fixture();
  try {
    const m = await f.engine.turn(
      "emp-ana",
      f.c.id,
      "Como corrigir VPN erro 809 no Windows 11?",
    );
    assert.match(m!.text, /exclusivo do Windows 10/);
    assert.doesNotMatch(m!.text, /reinstale/);
    const other = await f.engine.turn(
      "emp-ana",
      f.c.id,
      "Como corrigir VPN erro 809 no Windows 10?",
    );
    assert.match(other!.text, /reinstale/);
  } finally {
    f.store.close();
  }
});
test("campos ausentes são coletados e contexto preservado", async () => {
  const f = fixture();
  try {
    const m = await f.engine.turn("emp-ana", f.c.id, "VPN não conecta");
    assert.match(m!.text, /quantas pessoas/);
    assert.equal(f.store.conversation(f.c.id)!.draft, null);
    await f.engine.turn("emp-ana", f.c.id, "Só eu, tenho alternativa");
    assert.ok(f.store.conversation(f.c.id)!.draft);
    assert.match(f.store.conversation(f.c.id)!.draft!.description, /VPN/);
  } finally {
    f.store.close();
  }
});
test("crítico, pedido humano e atraso pausam o agente", async () => {
  for (const text of [
    "VPN caiu, equipe toda parada total",
    "Falar com analista",
    "Meus chamados",
  ]) {
    const f = fixture();
    try {
      await f.engine.turn("emp-ana", f.c.id, text);
      assert.equal(f.store.conversation(f.c.id)!.status, "waiting");
      assert.equal(f.store.conversation(f.c.id)!.draft, null);
      await f.engine.turn("emp-ana", f.c.id, "Mensagem adicional");
      assert.equal(
        f.store.messages(f.c.id).filter((m) => m.role === "assistant").length,
        1,
      );
    } finally {
      f.store.close();
    }
  }
});
test("analista assume, responde, devolve e encerra com persistência", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexo-test-")),
    path = join(dir, "db.sqlite");
  let s = new Store(path);
  try {
    const e = new Engine(s, new TicketService(s), new DemoPlanner()),
      c = s.createConversation("emp-ana");
    await e.turn("emp-ana", c.id, "Falar com analista");
    e.control(c.id, "support-1", "assume");
    e.reply(c.id, "support-1", "Vou investigar.");
    s.close();
    s = new Store(path);
    assert.equal(s.conversation(c.id)!.status, "human");
    assert.ok(s.messages(c.id).some((m) => m.text === "Vou investigar."));
    const e2 = new Engine(s, new TicketService(s), new DemoPlanner());
    e2.control(c.id, "support-1", "return");
    assert.equal(s.conversation(c.id)!.status, "bot");
    e2.control(c.id, "support-1", "close");
    await assert.rejects(e2.turn("emp-ana", c.id, "Olá"), /encerrada/);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("analista tomando controle durante inferência descarta resposta atrasada", async () => {
  const f = fixture();
  let release!: (p: Plan) => void;
  const planner: Planner = {
    mode: "llm",
    plan: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  const e = new Engine(f.store, f.service, planner);
  try {
    const result = e.turn("emp-ana", f.c.id, problem);
    await new Promise((resolve) => setImmediate(resolve));
    e.control(f.c.id, "support-1", "assume");
    release(await new DemoPlanner().plan(problem, f.c));
    assert.equal(await result, null);
    assert.equal(f.store.conversation(f.c.id)!.status, "human");
    assert.equal(
      f.store.messages(f.c.id).filter((m) => m.role === "assistant").length,
      0,
    );
  } finally {
    f.store.close();
  }
});
test("fora de escopo é redirecionado sem chamado", async () => {
  const f = fixture();
  try {
    const m = await f.engine.turn(
      "emp-ana",
      f.c.id,
      "Quero consultar férias e salário",
    );
    assert.match(m!.text, /RH/);
    assert.equal(f.store.tickets("emp-ana").length, 3);
  } finally {
    f.store.close();
  }
});
test("pedido desconhecido com baixa confiança vai para suporte", async () => {
  const f = fixture();
  try {
    await f.engine.turn("emp-ana", f.c.id, "xyz pedido incompreensível");
    assert.equal(f.store.conversation(f.c.id)!.status, "waiting");
  } finally {
    f.store.close();
  }
});
test("atraso do chamado relacionado não pode ser apagado com novo complemento", async () => {
  const f = fixture();
  try {
    await f.engine.turn(
      "emp-ana",
      f.c.id,
      "Notebook lento, só eu, tenho alternativa",
    );
    assert.equal(f.store.conversation(f.c.id)!.status, "waiting");
    assert.equal(f.store.conversation(f.c.id)!.draft, null);
    assert.equal(f.store.ticket("INC-20311")!.version, 1);
  } finally {
    f.store.close();
  }
});
test("falha do provedor encaminha para humano", async () => {
  const f = fixture();
  try {
    const e = new Engine(f.store, f.service, {
      mode: "llm",
      plan: async () => {
        throw new Error("provider timeout");
      },
    });
    await e.turn("emp-ana", f.c.id, problem);
    assert.equal(f.store.conversation(f.c.id)!.status, "waiting");
  } finally {
    f.store.close();
  }
});
test("limite de trinta mensagens persiste na sessão", () => {
  const f = fixture();
  try {
    const id = f.store.createSession("emp-ana");
    for (let i = 1; i <= 30; i++) assert.equal(f.store.consumeMessage(id), i);
    assert.equal(f.store.consumeMessage(id), null);
    assert.equal(f.store.session(id)!.count, 30);
  } finally {
    f.store.close();
  }
});
test("API exige autenticação, papel, origem e rejeita adulteração da confirmação", async () => {
  const f = fixture();
  const server = createApp(f.store, f.engine).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/api/me")).status, 401);
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ana@nexo.test", password: "demo" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { "Content-Type": "application/json", Cookie: cookie };
    assert.equal(
      (
        await fetch(base + "/api/analyst/" + f.c.id + "/control", {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "assume" }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/conversations", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
      403,
    );
    await f.engine.turn("emp-ana", f.c.id, problem);
    const token = f.store.conversation(f.c.id)!.draft!.token;
    assert.equal(
      (
        await fetch(base + "/api/conversations/" + f.c.id + "/confirm", {
          method: "POST",
          headers,
          body: JSON.stringify({ token, affected: 2000 }),
        })
      ).status,
      400,
    );
    assert.equal(f.store.tickets("emp-ana").length, 3);
    const c = await fetch(base + "/api/conversations/" + f.c.id + "/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
    });
    assert.equal(c.status, 200);
    const other = f.store.createConversation("emp-bruno");
    assert.equal(
      (
        await fetch(base + "/api/conversations/" + other.id, {
          headers: { Cookie: cookie },
        })
      ).status,
      400,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    f.store.close();
  }
});
