// Test-only helper: a minimal OpenAI-compatible mock server (plain node:http, no deps)
// standing in for auth.openai.com + api.openai.com so chatgpt-auth.test.md can exercise
// status/logout/refresh/request-shape with no real login and no network.
import http from "node:http";

const port = Number(process.argv[2] || 8931);

function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      issuer: `http://127.0.0.1:${port}`,
      authorization_endpoint: `http://127.0.0.1:${port}/api/accounts/authorize`,
      token_endpoint: `http://127.0.0.1:${port}/api/accounts/oauth/token`,
      jwks_uri: `http://127.0.0.1:${port}/jwks`,
      revocation_endpoint: `http://127.0.0.1:${port}/revoke`
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/accounts/oauth/token") {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    if (params.get("grant_type") !== "refresh_token" || params.get("refresh_token") !== "stale-refresh-token") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant", error_description: "bad refresh token" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      access_token: "refreshed-access-token-xyz",
      refresh_token: "refreshed-refresh-token-xyz",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/revoke") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("");
    return;
  }

  if (req.method === "GET" && url.pathname === "/models") {
    const auth = req.headers.authorization || "";
    if (auth !== "Bearer valid-access-token" && auth !== "Bearer refreshed-access-token-xyz") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid token" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      models: [
        { slug: "model-a", display_name: "Model A", visibility: "list" },
        { slug: "model-hidden", display_name: "Hidden", visibility: "internal" }
      ]
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/responses") {
    const body = await readBody(req);
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    const auth = req.headers.authorization || "";

    const problems = [];
    if (parsed.model !== "mock-chatgpt-model") problems.push("model");
    if (parsed.store !== false) problems.push("store");
    if (parsed.stream !== true) problems.push("stream");
    if (!Array.isArray(parsed.tools) || parsed.tools.length === 0 || parsed.tools[0].name !== "executeAux4") problems.push("tools");
    if (!auth.startsWith("Bearer ")) problems.push("auth");

    const outputText = problems.length === 0 ? `VALID:${auth.slice(7)}` : `INVALID:${problems.join(",")}`;

    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({
      type: "response.completed",
      response: {
        output_text: outputText,
        output: [],
        usage: { input_tokens: 3, output_tokens: 2 }
      }
    })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`chatgpt-mock-server listening on ${port}`);
});
