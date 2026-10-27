import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { resolve } from "node:path";
import { z } from "zod";
import type { Conversation, Employee } from "../shared/domain.js";
import { Store } from "./store.js";
import { Engine } from "./engine.js";
import { articles } from "./knowledge.js";

export function createApp(store: Store, engine: Engine) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.get("origin");
      if (
        origin &&
        (!/^https?:\/\//.test(origin) ||
          new URL(origin).host !== req.get("host"))
      ) {
        res.status(403).json({ error: "Origem não autorizada" });
        return;
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: "Envie JSON" });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "12kb" }));
  const getSession = (req: Request) => {
    const sid = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("nexo="))
      ?.slice(5);
    return sid ? store.session(sid) : undefined;
  };
  const identity = (req: Request) => {
    const session = getSession(req);
    const employee = session ? store.employee(session.employee) : undefined;
    if (!session || !employee) throw new Error("AUTH");
    return { session, employee };
  };
  const analyst = (req: Request) => {
    const auth = identity(req);
    if (auth.employee.role !== "analyst") throw new Error("FORBIDDEN");
    return auth;
  };
  const access = (employee: Employee, id: string) => {
    const c = store.conversation(id);
    if (!c || (employee.role !== "analyst" && c.ownerId !== employee.id))
      throw new Error("Conversa não encontrada");
    return c;
  };
  const view = (c: Conversation, count: number) => ({
    conversation: c,
    messages: store.messages(c.id),
    tickets: store.tickets(c.ownerId),
    employee: store.employee(c.ownerId),
    remaining: Math.max(0, 30 - count),
    mode: engine.planner.mode,
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, mode: engine.planner.mode }),
  );
  const loginAttempts = new Map<string, { at: number; count: number }>();
  app.post("/api/login", (req, res) => {
    const ip = req.ip ?? "local";
    const old = loginAttempts.get(ip);
    const bucket =
      old && Date.now() - old.at < 60000 ? old : { at: Date.now(), count: 0 };
    bucket.count++;
    loginAttempts.set(ip, bucket);
    if (bucket.count > 30) {
      res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
      return;
    }
    const data = z
      .object({
        email: z.email().max(160),
        password: z.string().min(1).max(200),
      })
      .strict()
      .parse(req.body);
    const e = store
      .employees()
      .find((e) => e.email.toLowerCase() === data.email.toLowerCase());
    if (process.env.DEMO_LOGIN === "false")
      throw new Error(
        "Login demonstrativo desabilitado. Integre um provedor de identidade antes de expor a aplicação.",
      );
    if (!e) {
      res
        .status(401)
        .json({ error: "Utilize uma das contas fictícias informadas na tela" });
      return;
    }
    const id = store.createSession(e.id);
    res.cookie("nexo", id, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 86400000,
    });
    res.json({ employee: e, mode: engine.planner.mode });
  });
  app.post("/api/logout", (req, res) => {
    const s = getSession(req);
    if (s) store.deleteSession(s.id);
    res.clearCookie("nexo");
    res.json({ ok: true });
  });
  app.get("/api/me", (req, res) => {
    const a = identity(req);
    res.json({
      employee: a.employee,
      remaining: 30 - a.session.count,
      mode: engine.planner.mode,
    });
  });
  app.get("/api/articles", (req, res) => {
    identity(req);
    res.json(articles);
  });
  app.get("/api/conversations", (req, res) => {
    const a = identity(req);
    res.json(
      store.conversations(
        a.employee.role === "analyst" ? undefined : a.employee.id,
      ),
    );
  });
  app.post("/api/conversations", (req, res) => {
    const a = identity(req);
    if (a.employee.role !== "employee") throw new Error("FORBIDDEN");
    res.json(store.createConversation(a.employee.id));
  });
  app.get("/api/conversations/:id", (req, res) => {
    const a = identity(req);
    res.json(view(access(a.employee, String(req.params.id)), a.session.count));
  });
  const textSchema = z
    .object({ text: z.string().trim().min(1).max(3000) })
    .strict();
  app.post("/api/conversations/:id/messages", async (req, res, next) => {
    try {
      const a = identity(req);
      if (a.employee.role !== "employee") throw new Error("FORBIDDEN");
      const id = String(req.params.id);
      const c = access(a.employee, id);
      if (c.status === "closed") throw new Error("Conversa encerrada");
      const { text } = textSchema.parse(req.body);
      if (store.consumeMessage(a.session.id) === null) {
        res
          .status(429)
          .json({ error: "Limite de 30 mensagens por sessão atingido." });
        return;
      }
      res.set({
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write(
        JSON.stringify({
          event: "progress",
          action:
            c.status === "bot"
              ? "Interpretando e verificando políticas"
              : "Enviando ao analista",
        }) + "\n",
      );
      await engine.turn(a.employee.id, id, text);
      res.end(
        JSON.stringify({
          event: "result",
          data: view(access(a.employee, id), getSession(req)?.count ?? 30),
        }) + "\n",
      );
    } catch (e) {
      if (res.headersSent)
        res.end(
          JSON.stringify({
            event: "error",
            error: e instanceof Error ? e.message : "Erro inesperado",
          }) + "\n",
        );
      else next(e);
    }
  });
  app.post("/api/conversations/:id/confirm", (req, res) => {
    const a = identity(req);
    if (a.employee.role !== "employee") throw new Error("FORBIDDEN");
    const { token } = z.object({ token: z.uuid() }).strict().parse(req.body);
    engine.confirm(a.employee.id, String(req.params.id), token);
    res.json(view(access(a.employee, String(req.params.id)), a.session.count));
  });
  app.post("/api/conversations/:id/cancel", (req, res) => {
    const a = identity(req);
    if (a.employee.role !== "employee") throw new Error("FORBIDDEN");
    engine.cancel(a.employee.id, String(req.params.id));
    res.json(view(access(a.employee, String(req.params.id)), a.session.count));
  });
  app.post("/api/analyst/:id/control", (req, res) => {
    const a = analyst(req);
    const { action } = z
      .object({ action: z.enum(["assume", "return", "close"]) })
      .strict()
      .parse(req.body);
    const c = engine.control(String(req.params.id), a.employee.id, action);
    res.json(view(c, a.session.count));
  });
  app.post("/api/analyst/:id/reply", (req, res) => {
    const a = analyst(req);
    const { text } = textSchema.parse(req.body);
    engine.reply(String(req.params.id), a.employee.id, text);
    res.json(view(access(a.employee, String(req.params.id)), a.session.count));
  });
  app.post("/api/analyst/fault", (req, res) => {
    analyst(req);
    const { mode } = z
      .object({ mode: z.enum(["off", "before", "after"]) })
      .strict()
      .parse(req.body);
    engine.service.failNext = mode;
    res.json({ ok: true });
  });
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Erro inesperado";
    const status =
      message === "AUTH"
        ? 401
        : message === "FORBIDDEN"
          ? 403
          : err instanceof z.ZodError
            ? 400
            : (err as { status?: number })?.status === 413
              ? 413
              : 400;
    res
      .status(status)
      .json({
        error:
          message === "AUTH"
            ? "Faça login para continuar"
            : message === "FORBIDDEN"
              ? "Acesso não autorizado"
              : err instanceof z.ZodError
                ? "Dados inválidos; confira os campos"
                : status === 413
                  ? "Mensagem muito grande"
                  : message,
      });
  });
  return app;
}
