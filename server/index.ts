import "dotenv/config";
import { Store } from "./store.js";
import { TicketService } from "./ticket-service.js";
import { Engine } from "./engine.js";
import { DemoPlanner, OpenAIPlanner } from "./planner.js";
import { createApp } from "./app.js";
const host = process.env.HOST || "127.0.0.1";
if (
  !["127.0.0.1", "localhost", "::1"].includes(host) &&
  process.env.DEMO_LOGIN !== "false"
)
  throw new Error(
    "Contas demonstrativas só podem ser servidas em loopback. Para exposição pública, implemente autenticação real.",
  );
const store = new Store(process.env.DATABASE_PATH || "data/nexo.sqlite");
const planner =
  process.env.AGENT_MODE === "llm" ? new OpenAIPlanner() : new DemoPlanner();
const app = createApp(
  store,
  new Engine(store, new TicketService(store), planner),
);
const server = app.listen(Number(process.env.PORT || 4100), host, () =>
  console.log(
    `Nexo Assist: http://${host}:${process.env.PORT || 4100} | interpretador ${planner.mode}`,
  ),
);
function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
