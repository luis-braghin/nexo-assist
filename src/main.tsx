import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  Headphones,
  LogOut,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Ticket as TicketIcon,
  X,
} from "lucide-react";
import type {
  ChatMessage,
  Conversation,
  ConversationView,
  Employee,
  Ticket,
} from "../shared/domain";
import "./style.css";
async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch("/api" + path, {
    credentials: "same-origin",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Não foi possível concluir");
  return data as T;
}
const labels = {
  bot: "Assistente ativo",
  waiting: "Aguardando analista",
  human: "Em atendimento humano",
  closed: "Encerrada",
};
const date = (s: string) =>
  new Date(s).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Sparkles size={20} />
      </span>
      <span>
        nexo<span className="brand-light"> assist</span>
      </span>
    </div>
  );
}
function App() {
  const [employee, setEmployee] = useState<Employee | null>(null),
    [mode, setMode] = useState("demo"),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [list, setList] = useState<Conversation[]>([]),
    [view, setView] = useState<ConversationView | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [filter, setFilter] = useState("all");
  const selected = useRef<string | null>(null);
  selected.current = view?.conversation.id ?? null;
  async function refresh(id = selected.current) {
    const rows = await api<Conversation[]>("/conversations");
    setList(rows);
    if (id) setView(await api<ConversationView>("/conversations/" + id));
  }
  useEffect(() => {
    api<{ employee: Employee; mode: string }>("/me")
      .then((a) => {
        setEmployee(a.employee);
        setMode(a.mode);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!employee) return;
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (!busy) refresh().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [employee, busy]);
  async function open(id: string) {
    try {
      setView(await api<ConversationView>("/conversations/" + id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function newChat() {
    try {
      const c = await api<Conversation>("/conversations", {});
      await refresh(c.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(text: string) {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      let id = selected.current;
      if (!id) {
        const c = await api<Conversation>("/conversations", {});
        id = c.id;
        await refresh(id);
      }
      if (employee?.role === "analyst") {
        await api("/analyst/" + id + "/reply", { text });
        await refresh(id);
        return;
      }
      const r = await fetch("/api/conversations/" + id + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error);
      }
      const reader = r.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.event === "progress") setProgress(event.action);
          if (event.event === "result") setView(event.data);
          if (event.event === "error") throw new Error(event.error);
        }
        if (chunk.done) break;
      }
      await refresh(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function mutate(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      setView(await api<ConversationView>(path, body));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready) return <div className="loading">Carregando Nexo Assist…</div>;
  if (!employee)
    return (
      <Login
        onLogin={(a) => {
          setEmployee(a.employee);
          setMode(a.mode);
        }}
      />
    );
  const analyst = employee.role === "analyst";
  const visible = list.filter((c) => filter === "all" || c.status === filter);
  return (
    <div className={"workspace " + (analyst ? "analyst" : "")}>
      <aside className="sidebar">
        <Brand />
        <div className="section-label">
          {analyst ? "CONSOLE DO ANALISTA" : "SEU ESPAÇO DE TI"}
        </div>
        {analyst ? (
          <>
            <h2>
              Fila de atendimento{" "}
              <span>{list.filter((c) => c.status === "waiting").length}</span>
            </h2>
            <select
              aria-label="Filtrar conversas"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Todas as conversas</option>
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </>
        ) : (
          <button className="primary new-chat" onClick={newChat}>
            <Plus size={17} /> Nova conversa
          </button>
        )}
        <div className="section-label history-label">
          {analyst ? "CONVERSAS" : "HISTÓRICO"}
        </div>
        <nav>
          {visible.map((c) => (
            <button
              className={
                "conversation " +
                (view?.conversation.id === c.id ? "selected" : "")
              }
              key={c.id}
              onClick={() => open(c.id)}
            >
              <MessageSquare size={16} />
              <span>
                <strong>
                  {c.topic.split("\n")[0]?.slice(0, 39) || "Nova conversa"}
                </strong>
                <small>
                  {analyst ? c.ownerId + " · " : ""}
                  {labels[c.status]}
                </small>
              </span>
            </button>
          ))}
          {!visible.length && (
            <p className="muted small">As conversas aparecerão aqui.</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note">
            <ShieldCheck size={17} />
            <span>
              Dados fictícios
              <br />
              <small>Ambiente de demonstração</small>
            </span>
          </div>
          <div className="profile">
            <span className="avatar">
              {employee.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </span>
            <span>
              <strong>{employee.name}</strong>
              <small>{employee.department}</small>
            </span>
            <button
              className="icon-button"
              title="Sair"
              aria-label="Sair"
              onClick={async () => {
                await api("/logout", {});
                setEmployee(null);
                setView(null);
                setList([]);
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {analyst ? "ATENDIMENTO" : "SERVICE DESK"}
            </span>
            <h1>
              {analyst
                ? "Conversa com funcionário"
                : "Seu suporte de TI, mais simples"}
            </h1>
          </div>
          <div className="top-status">
            <span className="mode">
              {mode === "demo" ? "Modo demonstração" : "Modelo de IA conectado"}
            </span>
            <span className={"status " + (view?.conversation.status ?? "bot")}>
              {view ? labels[view.conversation.status] : "Assistente ativo"}
            </span>
          </div>
        </header>
        {analyst && view && (
          <div className="control-bar">
            <span>
              <Headphones size={16} /> Controle do atendimento
            </span>
            <div>
              <button
                disabled={
                  busy ||
                  view.conversation.status === "closed" ||
                  view.conversation.status === "human"
                }
                onClick={() =>
                  mutate("/analyst/" + view.conversation.id + "/control", {
                    action: "assume",
                  })
                }
              >
                Assumir conversa
              </button>
              <button
                disabled={busy || view.conversation.status !== "human"}
                onClick={() =>
                  mutate("/analyst/" + view.conversation.id + "/control", {
                    action: "return",
                  })
                }
              >
                Devolver ao agente
              </button>
              <button
                disabled={busy || view.conversation.status === "closed"}
                onClick={() =>
                  mutate("/analyst/" + view.conversation.id + "/control", {
                    action: "close",
                  })
                }
              >
                Encerrar
              </button>
            </div>
          </div>
        )}
        <div className="messages" key={view?.conversation.id ?? "empty"}>
          {!view?.messages.length ? (
            <div className="welcome">
              <span className="welcome-icon">
                <Sparkles size={30} />
              </span>
              <span className="eyebrow">
                OLÁ, {employee.name.split(" ")[0]?.toUpperCase()}
              </span>
              <h2>
                {analyst
                  ? "O próximo atendimento começa aqui."
                  : "Como posso ajudar hoje?"}
              </h2>
              <p>
                {analyst
                  ? "Selecione uma conversa na fila para consultar o histórico e assumir o atendimento."
                  : "Tire dúvidas, acompanhe chamados ou conte o que precisa. Vamos resolver juntos."}
              </p>
              {!analyst && (
                <div className="starter-grid">
                  {[
                    ["Meus chamados", "Acompanhe o andamento"],
                    [
                      "Como corrigir VPN erro 809 no Windows 11?",
                      "Resolva dúvidas de TI",
                    ],
                    [
                      "Preciso de um monitor, só eu, sem urgência",
                      "Solicite equipamento",
                    ],
                    ["Falar com analista", "Converse com o suporte"],
                  ].map(([text, sub]) => (
                    <button key={text} onClick={() => send(text!)}>
                      <span>
                        <strong>{text}</strong>
                        <small>{sub}</small>
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            view.messages.map((m) => (
              <Message
                key={m.id}
                message={m}
                view={view}
                analyst={analyst}
                busy={busy}
                onSend={send}
                onConfirm={(token) =>
                  mutate(
                    "/conversations/" + view.conversation.id + "/confirm",
                    { token },
                  )
                }
                onCancel={() =>
                  mutate(
                    "/conversations/" + view.conversation.id + "/cancel",
                    {},
                  )
                }
              />
            ))
          )}
          {busy && (
            <div className="working">
              <span className="pulse" />
              {progress || "Processando…"}
            </div>
          )}
          <ScrollEnd dependency={view?.messages.length} />
        </div>
        <div className="composer-area">
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={() => setError("")} aria-label="Fechar erro">
                <X size={15} />
              </button>
            </div>
          )}
          {view &&
            ["human", "waiting"].includes(view.conversation.status) &&
            !analyst && (
              <div className="human-notice">
                <Headphones size={15} /> O agente está pausado. Suas mensagens
                serão encaminhadas ao suporte.
              </div>
            )}
          <Composer
            onSend={send}
            disabled={
              busy ||
              view?.conversation.status === "closed" ||
              (!analyst && view?.remaining === 0) ||
              (analyst && view?.conversation.status !== "human")
            }
            analyst={analyst}
          />
          <div className="composer-footer">
            <span>
              <ShieldCheck size={12} /> Não compartilhe senhas ou códigos.
            </span>
            <span>
              {!analyst
                ? `${view?.remaining ?? 30} mensagens restantes na sessão`
                : "Respostas identificadas como atendimento humano"}
            </span>
          </div>
        </div>
      </main>
      {analyst && (
        <aside className="ticket-panel">
          <div className="section-label">CONTEXTO DO FUNCIONÁRIO</div>
          {view ? (
            <>
              <h2>{view.employee.name}</h2>
              <p className="muted small">
                {view.employee.department}
                <br />
                {view.employee.email}
              </p>
              {view.conversation.summary && (
                <div className="summary">
                  <strong>Resumo para o suporte</strong>
                  <p>{view.conversation.summary}</p>
                </div>
              )}
              <h3>
                Chamados <span>{view.tickets.length}</span>
              </h3>
              {view.tickets.map((t) => (
                <TicketCard key={t.id} ticket={t} />
              ))}
              <details className="simulation">
                <summary>Simular indisponibilidade</summary>
                <p>
                  Afeta a próxima gravação. Antes: não grava. Depois: grava,
                  perde resposta e reconcilia recibo.
                </p>
                <button
                  onClick={() =>
                    api("/analyst/fault", { mode: "before" }).catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  Falhar antes
                </button>
                <button
                  onClick={() =>
                    api("/analyst/fault", { mode: "after" }).catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  Falhar após gravação
                </button>
              </details>
            </>
          ) : (
            <p className="muted small">
              Selecione uma conversa para ver os chamados do titular.
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
function Login({
  onLogin,
}: {
  onLogin: (a: { employee: Employee; mode: string }) => void;
}) {
  const [email, setEmail] = useState("ana@nexo.test"),
    [password, setPassword] = useState("demo"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="login">
      <section className="login-story">
        <Brand />
        <div>
          <div className="login-tag">
            <span /> INTELIGÊNCIA QUE SIMPLIFICA
          </div>
          <h1>
            Seu problema de TI,
            <br />
            resolvido em
            <br />
            uma conversa<span>.</span>
          </h1>
          <p>
            Menos formulários. Mais contexto.
            <br />
            Um assistente que entende e conecta você à solução.
          </p>
          <div className="story-features">
            <span>
              <MessageSquare size={17} /> Atendimento natural
            </span>
            <span>
              <ShieldCheck size={17} /> Decisões transparentes
            </span>
            <span>
              <Headphones size={17} /> Pessoas quando precisar
            </span>
          </div>
        </div>
        <footer>
          NEXO ASSIST <span>Service desk com inteligência e cuidado.</span>
        </footer>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          <span className="eyebrow">BEM-VINDO AO NEXO ASSIST</span>
          <h2>Vamos resolver?</h2>
          <p className="muted">Entre para conversar com seu suporte de TI.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                onLogin(await api("/login", { email, password }));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              E-mail corporativo
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="primary login-submit" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <div className="demo-box">
            <div>
              <CircleHelp size={17} />
              <strong>Explore com dados fictícios</strong>
            </div>
            <p>
              Escolha um perfil. Qualquer senha não vazia é aceita neste
              ambiente local.
            </p>
            <div className="demo-accounts">
              {[
                ["Ana · Operações", "ana@nexo.test"],
                ["Bruno · Comercial", "bruno@nexo.test"],
                ["Carla · Produto", "carla@nexo.test"],
                ["Console do analista", "suporte@nexo.test"],
              ].map(([name, address]) => (
                <button
                  key={address}
                  type="button"
                  onClick={() => setEmail(address!)}
                >
                  {name}
                  <small>{address}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
function ScrollEnd({ dependency }: { dependency: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [dependency]);
  return <div ref={ref} />;
}
function Composer({
  onSend,
  disabled,
  analyst,
}: {
  onSend: (s: string) => Promise<void>;
  disabled: boolean;
  analyst: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) {
          onSend(text);
          setText("");
        }
      }}
    >
      <textarea
        aria-label="Mensagem"
        placeholder={
          analyst
            ? "Escreva sua resposta como analista…"
            : "Conte o que você precisa…"
        }
        value={text}
        maxLength={3000}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (text.trim() && !disabled) {
              onSend(text);
              setText("");
            }
          }
        }}
      />
      <button aria-label="Enviar mensagem" disabled={disabled || !text.trim()}>
        <ArrowUp size={19} />
      </button>
    </form>
  );
}
function TicketCard({ ticket: t }: { ticket: Ticket }) {
  return (
    <div className="ticket-card">
      <div className="ticket-card-top">
        <span>
          <TicketIcon size={13} /> {t.id}
        </span>
        <span className={"priority p-" + t.priority}>{t.priority}</span>
      </div>
      <strong>{t.title}</strong>
      <div className="ticket-meta">
        <span>{t.status}</span>
        <span>{t.category}</span>
      </div>
      <div className={"ticket-due " + (t.overdue ? "overdue" : "")}>
        {t.overdue ? "Prazo vencido" : "Prazo de atendimento"} · {date(t.dueAt)}
      </div>
    </div>
  );
}
function Message({
  message: m,
  view,
  analyst,
  busy,
  onSend,
  onConfirm,
  onCancel,
}: {
  message: ChatMessage;
  view: ConversationView;
  analyst: boolean;
  busy: boolean;
  onSend: (s: string) => Promise<void>;
  onConfirm: (s: string) => void;
  onCancel: () => void;
}) {
  const [trace, setTrace] = useState(false);
  const active = m.draft && view.conversation.draft?.token === m.draft.token;
  return (
    <div className={"message " + m.role}>
      <div className="message-avatar">
        {m.role === "assistant" ? (
          <Bot size={17} />
        ) : m.role === "analyst" ? (
          <Headphones size={17} />
        ) : m.role === "user" ? (
          "VC"
        ) : (
          <Check size={13} />
        )}
      </div>
      <div className="message-body">
        <div className="message-byline">
          {m.role === "assistant"
            ? "Nexo Assist"
            : m.role === "analyst"
              ? "Analista de suporte"
              : m.role === "user"
                ? "Funcionário"
                : "Sistema"}
          <span>{date(m.createdAt)}</span>
        </div>
        {m.decision && (
          <div className="trace">
            <button onClick={() => setTrace(!trace)}>
              <Sparkles size={12} />
              {m.decision.steps[0]?.action}
              <ChevronDown size={12} />
            </button>
            {trace && (
              <div className="trace-details">
                <strong>Decisão observável</strong>
                <p>{m.decision.reason}</p>
                <span>
                  Intenção: {m.decision.intent} · Confiança declarada:{" "}
                  {Math.round(m.decision.confidence * 100)}% ·{" "}
                  {m.decision.elapsedMs} ms
                </span>
                <p className="small">
                  {m.decision.mode === "demo"
                    ? "Interpretação por regras de demonstração."
                    : "Resumo de decisão, sem exposição de raciocínio privado."}
                </p>
                {m.decision.steps.map((s, i) => (
                  <p key={i}>
                    {s.reason}
                    <br />
                    {s.evidence.join(" · ")}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="message-text">{m.text}</div>
        {m.articles && (
          <div className="sources">
            {m.articles.map((a) => (
              <span key={a.id}>
                {a.id} · {a.title}
              </span>
            ))}
          </div>
        )}
        {m.tickets?.map((t) => (
          <TicketCard key={t.id} ticket={t} />
        ))}
        {m.draft && (
          <div className={"draft " + (!active ? "inactive" : "")}>
            <div className="draft-heading">
              <TicketIcon size={17} />
              <strong>Revise antes de confirmar</strong>
              <span>
                {m.draft.operation === "create"
                  ? "Novo chamado"
                  : m.draft.operation === "reopen"
                    ? "Reabertura"
                    : "Complemento"}
              </span>
            </div>
            <h3>{m.draft.title}</h3>
            <p>{m.draft.description}</p>
            <dl>
              <div>
                <dt>Tipo</dt>
                <dd>{m.draft.type}</dd>
              </div>
              <div>
                <dt>Categoria</dt>
                <dd>{m.draft.category}</dd>
              </div>
              <div>
                <dt>Prioridade</dt>
                <dd>{m.draft.priority}</dd>
              </div>
              <div>
                <dt>Afetados</dt>
                <dd>{m.draft.affected}</dd>
              </div>
            </dl>
            {active && !analyst ? (
              <div className="draft-actions">
                <button
                  className="primary"
                  disabled={busy || view.conversation.status !== "bot"}
                  onClick={() => onConfirm(m.draft!.token)}
                >
                  <Check size={15} /> Confirmar{" "}
                  {m.draft.operation === "create" ? "criação" : "alteração"}
                </button>
                <button disabled={busy} onClick={onCancel}>
                  Cancelar / corrigir
                </button>
              </div>
            ) : (
              <small>Prévia histórica — sem ação disponível.</small>
            )}
          </div>
        )}
        {m.suggestions && !analyst && view.conversation.status === "bot" && (
          <div className="suggestions">
            {m.suggestions.map((s) => (
              <button key={s} disabled={busy} onClick={() => onSend(s)}>
                {s}
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
