import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");

export class TokenManager {
  constructor(config = {}) {
    this.accessToken = config.apiKey || "";
    this.refreshToken = config.refreshToken || "";
    this.expiresAt = 0;
    this.persistToCodex = config.codexAuth || false;
  }

  needsRefresh() {
    if (!this.refreshToken) return false;
    return this.expiresAt === 0 || Date.now() >= this.expiresAt - 30000;
  }

  async getAccessToken() {
    if (this.needsRefresh()) {
      await this.refresh();
    }
    return this.accessToken;
  }

  async refresh() {
    if (!this.refreshToken) return;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: CLIENT_ID
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }
    if (data.expires_in) {
      this.expiresAt = Date.now() + data.expires_in * 1000;
    }

    if (this.persistToCodex) {
      saveCodexAuth(data);
    }
  }
}

function saveCodexAuth(tokens) {
  try {
    let existing = {};
    if (fs.existsSync(CODEX_AUTH_PATH)) {
      existing = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, "utf-8"));
    }
    existing.tokens = {
      ...existing.tokens,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || existing.tokens?.refresh_token
    };
    existing.last_refresh = new Date().toISOString();
    fs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify(existing, null, 2));
  } catch {}
}

export function loadCodexAuth() {
  try {
    if (!fs.existsSync(CODEX_AUTH_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, "utf-8"));
    if (!data.tokens || !data.tokens.refresh_token) return null;
    return {
      apiKey: data.tokens.access_token || "",
      refreshToken: data.tokens.refresh_token,
      accountId: data.tokens.account_id || "",
      codexAuth: true
    };
  } catch {
    return null;
  }
}

