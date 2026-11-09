import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

// Overridable for tests only — a local mock server stands in for OpenAI's auth/resource
// hosts so auth/refresh/revoke flows can be exercised with no real login and no network.
// Production defaults are unchanged when these env vars are unset.
const ISSUER = process.env.AUX4_CHATGPT_ISSUER || "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = process.env.AUX4_CHATGPT_RESOURCE || "https://api.openai.com/v1";
const APP_DIR = path.join(os.homedir(), ".config", "aux4-ai-agent");
const AUTH_FILE = path.join(APP_DIR, "chatgpt-auth.json");
const HOST_FILE = path.join(APP_DIR, "host-id");
const LOCK_FILE = path.join(APP_DIR, "chatgpt-auth.lock");
const AUTH_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

function ensurePrivateDir() {
  fs.mkdirSync(APP_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(APP_DIR, 0o700); } catch {}
}

function readAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Could not read ChatGPT auth data at ${AUTH_FILE}: ${error.message}`);
  }
}

function writePrivateJson(file, value) {
  ensurePrivateDir();
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

function getHostId() {
  ensurePrivateDir();
  try {
    const existing = fs.readFileSync(HOST_FILE, "utf8").trim();
    if (existing) return existing;
  } catch {}
  const hostId = `urn:uuid:${crypto.randomUUID()}`;
  fs.writeFileSync(HOST_FILE, hostId, { mode: 0o600, flag: "wx" });
  return hostId;
}

function base64url(data) {
  return Buffer.from(data).toString("base64url");
}

async function discover() {
  const response = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error(`OpenAI discovery failed (${response.status})`);
  return response.json();
}

async function openBrowser(url) {
  const [command, args] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  await new Promise(resolve => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", resolve);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

function callbackCode(server, state, redirectUri) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("ChatGPT sign-in timed out after five minutes."));
    }, 5 * 60 * 1000);

    server.on("request", (request, response) => {
      const url = new URL(request.url, redirectUri);
      if (url.pathname !== "/auth/callback") {
        response.writeHead(404).end("Not found");
        return;
      }
      if (url.searchParams.get("state") !== state) {
        response.writeHead(400).end("Sign-in state did not match. Close this page and retry.");
        clearTimeout(timeout);
        server.close();
        reject(new Error("ChatGPT sign-in state validation failed."));
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("ChatGPT sign-in was not completed. You can close this page.");
        clearTimeout(timeout);
        server.close();
        reject(new Error(`ChatGPT sign-in was not completed: ${error}`));
        return;
      }
      const code = url.searchParams.get("code");
      const clientId = url.searchParams.get("client_id");
      if (!code) {
        response.writeHead(400).end("The sign-in callback did not include the authorization code.");
        clearTimeout(timeout);
        server.close();
        reject(new Error("ChatGPT sign-in callback was missing its authorization code."));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<html><body>ChatGPT connected. You may close this window.</body></html>");
      clearTimeout(timeout);
      server.close();
      resolve({ code, clientId });
    });
  });
}

async function verifyIdToken(idToken, clientId, nonce) {
  const parts = String(idToken || "").split(".");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!header.kid || !["RS256", "PS256", "ES256"].includes(header.alg)) {
    throw new Error("OpenAI returned an ID token with an unsupported signing algorithm.");
  }

  const metadata = await discover();
  const jwksResponse = await fetch(metadata.jwks_uri);
  if (!jwksResponse.ok) throw new Error(`Could not fetch OpenAI signing keys (${jwksResponse.status}).`);
  const jwks = await jwksResponse.json();
  const jwk = (jwks.keys || []).find(key => key.kid === header.kid);
  if (!jwk) throw new Error("Could not find the signing key for OpenAI's ID token.");

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const signedData = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  const verifyOptions = header.alg === "ES256"
    ? { key: publicKey, dsaEncoding: "ieee-p1363" }
    : header.alg === "PS256"
      ? { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }
      : publicKey;
  const algorithm = header.alg === "RS256" ? "RSA-SHA256" : "sha256";
  if (!crypto.verify(algorithm, signedData, verifyOptions, signature)) {
    throw new Error("OpenAI ID token signature validation failed.");
  }

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audiences.includes(clientId) || (audiences.length > 1 && claims.azp !== clientId) || !claims.sub || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.iat && claims.iat > now + 60) || (claims.nbf && claims.nbf > now) || claims.nonce !== nonce) {
    throw new Error("OpenAI ID token claims validation failed.");
  }
  return claims;
}

export async function signInChatGPT() {
  const previous = readAuth();
  const state = base64url(crypto.randomBytes(32));
  const nonce = base64url(crypto.randomBytes(32));
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const hostId = getHostId();
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
  const clientId = previous?.client_id || "dynamic_agent_client";
  const authorization = new URL(AUTHORIZE_URL);
  const params = {
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: AUTH_SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: challenge,
    ext_agent_host_id: hostId
  };
  if (clientId === "dynamic_agent_client") params.agent_name_hint = "aux4 ai-agent";
  if (previous?.email) params.login_hint = previous.email;
  for (const [key, value] of Object.entries(params)) authorization.searchParams.set(key, value);
  const pendingCallback = callbackCode(server, state, redirectUri);

  console.log("Continue with ChatGPT in your browser. If it does not open automatically, copy this URL:");
  console.log(authorization.toString());
  await openBrowser(authorization.toString());
  const { code, clientId: callbackClientId } = await pendingCallback;
  const issuedClientId = callbackClientId || (clientId === "dynamic_agent_client" ? "" : clientId);
  if (!issuedClientId) throw new Error("OpenAI did not return the issued client ID for this new registration.");
  if (clientId !== "dynamic_agent_client" && callbackClientId && callbackClientId !== clientId) {
    throw new Error("OpenAI returned a different client ID than the saved ChatGPT registration.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: issuedClientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: RESOURCE
  });
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000)
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok) throw new Error(`ChatGPT token exchange failed (${tokenResponse.status}): ${tokens.error_description || tokens.error || "unknown error"}`);
  if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token || !Number.isFinite(tokens.expires_in)) {
    throw new Error("OpenAI returned an incomplete ChatGPT token response.");
  }
  const scopes = (tokens.scope || "").split(/\s+/).filter(Boolean);
  if (!scopes.includes("chatgpt.tokens.use.direct")) {
    throw new Error("ChatGPT sign-in succeeded, but permission to use ChatGPT plan credits was not granted.");
  }
  const identity = await verifyIdToken(tokens.id_token, issuedClientId, nonce);
  if (previous?.sub && previous.sub !== identity.sub) {
    throw new Error("The signed-in ChatGPT account did not match the selected saved account.");
  }

  const record = {
    issuer: ISSUER,
    subject: identity.sub,
    email: identity.email || "",
    name: identity.name || "",
    client_id: issuedClientId,
    ext_agent_host_id: hostId,
    id_token: tokens.id_token,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_at: Date.now() + tokens.expires_in * 1000,
    scopes,
    saved_at: new Date().toISOString()
  };
  const release = await acquireAuthLock();
  try {
    writePrivateJson(AUTH_FILE, record);
  } finally {
    release();
  }
  console.log(`Signed in to ChatGPT${record.email ? ` as ${record.email}` : ""}.`);
}

export function getChatGPTAuth() {
  const auth = readAuth();
  if (!auth?.access_token || !auth?.refresh_token || !auth?.client_id) return null;
  return auth;
}

export function chatGPTAuthStatus() {
  const auth = getChatGPTAuth();
  if (!auth) {
    console.log("Not signed in to ChatGPT.");
    return;
  }
  const hasPlanPermission = auth.scopes?.includes("chatgpt.tokens.use.direct");
  console.log(`Signed in to ChatGPT${auth.email ? ` as ${auth.email}` : ""}.`);
  console.log(`ChatGPT plan usage: ${hasPlanPermission ? "enabled" : "not authorized"}`);
}

async function acquireAuthLock() {
  ensurePrivateDir();
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      const descriptor = fs.openSync(LOCK_FILE, "wx", 0o600);
      return () => {
        fs.closeSync(descriptor);
        fs.rmSync(LOCK_FILE, { force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > 120_000) fs.rmSync(LOCK_FILE, { force: true });
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error("Timed out waiting for another ChatGPT token refresh to finish.");
}

export async function getChatGPTAccessToken() {
  const release = await acquireAuthLock();
  try {
    const auth = getChatGPTAuth();
    if (!auth) throw new Error("Not signed in to ChatGPT. Run `aux4 ai agent auth login` first.");
    if (auth.expires_at > Date.now() + 30_000) return auth.access_token;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: auth.client_id,
      refresh_token: auth.refresh_token,
      resource: RESOURCE
    });
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30_000)
    });
    const tokens = await response.json();
    if (!response.ok) throw new Error(`ChatGPT token refresh failed (${response.status}): ${tokens.error_description || tokens.error || "run aux4 ai agent auth login again"}`);
    if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in)) {
      throw new Error("OpenAI returned an incomplete ChatGPT refresh response.");
    }
    const updated = {
      ...auth,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type || auth.token_type,
      expires_at: Date.now() + tokens.expires_in * 1000,
      scopes: (tokens.scope || auth.scopes.join(" ")).split(/\s+/).filter(Boolean),
      saved_at: new Date().toISOString()
    };
    writePrivateJson(AUTH_FILE, updated);
    return updated.access_token;
  } finally {
    release();
  }
}

export async function listChatGPTModels() {
  const accessToken = await getChatGPTAccessToken();
  const response = await fetch(`${RESOURCE}/models`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Could not list ChatGPT models (${response.status}): ${data.error?.message || "unknown error"}`);
  return (data.models || []).filter(model => model.visibility === "list").map(model => ({
    id: model.slug,
    name: model.display_name || model.slug
  }));
}

export async function signOutChatGPT() {
  const release = await acquireAuthLock();
  let revocationConfirmed = false;
  let auth;
  try {
    auth = getChatGPTAuth();
    if (!auth) {
      console.log("Not signed in to ChatGPT.");
      return;
    }
    try {
      const metadata = await discover();
      if (metadata.revocation_endpoint) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetch(metadata.revocation_endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ token: auth.refresh_token, token_type_hint: "refresh_token", client_id: auth.client_id }),
              signal: AbortSignal.timeout(10_000)
            });
            if (response.status === 200) {
              revocationConfirmed = true;
              break;
            }
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    } catch {
      revocationConfirmed = false;
    }
    writePrivateJson(AUTH_FILE, {
      issuer: auth.issuer,
      subject: auth.subject,
      email: auth.email,
      name: auth.name,
      client_id: auth.client_id,
      ext_agent_host_id: auth.ext_agent_host_id,
      signed_out_at: new Date().toISOString()
    });
  } finally {
    release();
  }
  console.log(revocationConfirmed
    ? "Signed out of ChatGPT. You can also manage app access in ChatGPT Settings."
    : "Signed out locally. OpenAI could not confirm remote revocation; you can remove aux4 ai-agent in ChatGPT Settings.");
}

export async function chatGPTAuthExecutor({ action }) {
  if (action === "login") return signInChatGPT();
  if (action === "status") return chatGPTAuthStatus();
  if (action === "logout") return signOutChatGPT();
  if (action === "models") {
    const models = await listChatGPTModels();
    for (const model of models) console.log(`${model.id}\t${model.name}`);
    return;
  }
  throw new Error("Usage: aux4 ai agent auth <login|status|models|logout>");
}
