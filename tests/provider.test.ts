import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DemoPlanner, OpenAIPlanner } from "../server/planner.js";
import { Store } from "../server/store.js";
test("adaptador real envia schema estrito e valida resposta usando provedor HTTP local", async () => {
  const store = new Store(":memory:");
  const conversation = store.createConversation("emp-ana");
  const plan = await new DemoPlanner().plan(
    "VPN não conecta, só eu, sem alternativa",
    conversation,
  );
  let captured: Record<string, unknown> | undefined;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    captured = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "local-fixture",
        object: "chat.completion",
        created: 1,
        model: "local-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(plan) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const before = {
    key: process.env.OPENAI_API_KEY,
    url: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  };
  try {
    process.env.OPENAI_API_KEY = "local-test-placeholder";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.OPENAI_MODEL = "local-model";
    const result = await new OpenAIPlanner().plan(
      "VPN não conecta, só eu, sem alternativa",
      conversation,
    );
    assert.equal(result.intent, "create");
    const format = captured?.response_format as {
      type: string;
      json_schema: {
        strict: boolean;
        schema: { additionalProperties: boolean };
      };
    };
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.strict, true);
    assert.equal(format.json_schema.schema.additionalProperties, false);
    assert.equal(captured?.max_tokens, 800);
  } finally {
    for (const [key, value] of Object.entries({
      OPENAI_API_KEY: before.key,
      OPENAI_BASE_URL: before.url,
      OPENAI_MODEL: before.model,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
