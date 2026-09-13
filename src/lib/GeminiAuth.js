import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GEMINI_DIR = path.join(os.homedir(), ".gemini");
const GEMINI_CREDS_PATH = path.join(GEMINI_DIR, "oauth_creds.json");

export class GeminiTokenManager {
  constructor(config = {}) {
    this.accessToken = config.accessToken || "";
    this.refreshToken = config.refreshToken || "";
    this.expiresAt = config.expiresAt || 0;
    // The Gemini CLI OAuth client id/secret are not embedded in source. They come from
    // config, falling back to the environment, so no credential is committed to the repo.
    // These are the installed-app client credentials the gemini-cli distributes; supply
    // your own via --model config or GEMINI_CLI_CLIENT_ID / GEMINI_CLI_CLIENT_SECRET.
    this.clientId = config.clientId || process.env.GEMINI_CLI_CLIENT_ID || "";
    this.clientSecret = config.clientSecret || process.env.GEMINI_CLI_CLIENT_SECRET || "";
  }

  needsRefresh() {
    if (!this.refreshToken) return false;
    return this.expiresAt === 0 || Date.now() >= this.expiresAt - 30000;
  }

  async refresh() {
    if (!this.needsRefresh()) return;

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        "Gemini CLI OAuth client id/secret are not set. Provide them in the model config " +
          "(clientId/clientSecret) or via GEMINI_CLI_CLIENT_ID / GEMINI_CLI_CLIENT_SECRET."
      );
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini token refresh failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }
    if (data.expires_in) {
      this.expiresAt = Date.now() + data.expires_in * 1000;
    }

    saveGeminiCreds({
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expiry_date: this.expiresAt
    });
  }
}

function saveGeminiCreds(tokens) {
  try {
    let existing = {};
    if (fs.existsSync(GEMINI_CREDS_PATH)) {
      existing = JSON.parse(fs.readFileSync(GEMINI_CREDS_PATH, "utf-8"));
    }
    existing.access_token = tokens.access_token;
    existing.refresh_token = tokens.refresh_token || existing.refresh_token;
    existing.expiry_date = tokens.expiry_date;
    fs.writeFileSync(GEMINI_CREDS_PATH, JSON.stringify(existing, null, 2));
  } catch {}
}

export function loadGeminiAuth() {
  // 1. Check environment variable
  const envRefreshToken = process.env.GEMINI_CLI_REFRESH_TOKEN;
  if (envRefreshToken) {
    return { accessToken: "", refreshToken: envRefreshToken };
  }

  // 2. Load from ~/.gemini/oauth_creds.json
  try {
    if (fs.existsSync(GEMINI_CREDS_PATH)) {
      const data = JSON.parse(fs.readFileSync(GEMINI_CREDS_PATH, "utf-8"));
      // Standard Google OAuth format
      if (data.refresh_token) {
        return {
          accessToken: data.access_token || "",
          refreshToken: data.refresh_token,
          expiresAt: data.expiry_date || 0
        };
      }
      // Gemini CLI HybridTokenStorage format
      if (data.token && data.token.refreshToken) {
        return {
          accessToken: data.token.accessToken || "",
          refreshToken: data.token.refreshToken,
          expiresAt: data.token.expiresAt || 0
        };
      }
    }
  } catch {}

  return null;
}
