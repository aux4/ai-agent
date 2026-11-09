# Sign in with ChatGPT

Exercises `aux4 ai agent auth` and `api: chatgpt` against a local mock server
(`chatgpt-mock-server.mjs`) standing in for `auth.openai.com` / `api.openai.com`.
No real login, no network, no `OPENAI_API_KEY` needed — these run in CI.

```beforeAll
node chatgpt-mock-server.mjs 8931 >chatgpt-mock-server.log 2>&1 &
echo $! > chatgpt-mock-server.pid
sleep 1
```

```afterAll
kill "$(cat chatgpt-mock-server.pid)" 2>/dev/null || true
rm -rf chatgpt-mock-server.pid chatgpt-mock-server.log
rm -rf chatgpt-home-signed-out chatgpt-home-signed-in chatgpt-home-logout chatgpt-home-shape chatgpt-home-refresh chatgpt-home-none
```

## auth status when signed out

### should report not signed in when no credentials are saved

```execute
HOME=./chatgpt-home-signed-out aux4 ai agent auth status
```

```expect
Not signed in to ChatGPT.
```

## auth status when signed in

```file:chatgpt-home-signed-in/.config/aux4-ai-agent/chatgpt-auth.json
{
  "issuer": "http://127.0.0.1:8931",
  "subject": "sub-123",
  "email": "person@example.com",
  "name": "Test Person",
  "client_id": "test-client-id",
  "ext_agent_host_id": "urn:uuid:test-host",
  "id_token": "fake.id.token",
  "access_token": "valid-access-token",
  "refresh_token": "valid-refresh-token",
  "token_type": "Bearer",
  "expires_at": 4102444800000,
  "scopes": ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
  "saved_at": "2024-01-01T00:00:00.000Z"
}
```

### should report the signed-in account and enabled plan usage

```execute
HOME=./chatgpt-home-signed-in aux4 ai agent auth status
```

```expect
Signed in to ChatGPT as person@example.com.
ChatGPT plan usage: enabled
```

## auth logout

```file:chatgpt-home-logout/.config/aux4-ai-agent/chatgpt-auth.json
{
  "issuer": "http://127.0.0.1:8931",
  "subject": "sub-123",
  "email": "person@example.com",
  "name": "Test Person",
  "client_id": "test-client-id",
  "ext_agent_host_id": "urn:uuid:test-host",
  "id_token": "fake.id.token",
  "access_token": "valid-access-token",
  "refresh_token": "valid-refresh-token",
  "token_type": "Bearer",
  "expires_at": 4102444800000,
  "scopes": ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
  "saved_at": "2024-01-01T00:00:00.000Z"
}
```

### should revoke, clear the saved session, and report signed out afterwards

```timeout
15000
```

```execute
HOME=./chatgpt-home-logout AUX4_CHATGPT_ISSUER=http://127.0.0.1:8931 aux4 ai agent auth logout && echo "---" && HOME=./chatgpt-home-logout aux4 ai agent auth status
```

```expect
Signed out of ChatGPT. You can also manage app access in ChatGPT Settings.
---
Not signed in to ChatGPT.
```

## api: chatgpt request shape

```file:chatgpt-home-shape/.config/aux4-ai-agent/chatgpt-auth.json
{
  "issuer": "http://127.0.0.1:8931",
  "subject": "sub-123",
  "email": "person@example.com",
  "name": "Test Person",
  "client_id": "test-client-id",
  "ext_agent_host_id": "urn:uuid:test-host",
  "id_token": "fake.id.token",
  "access_token": "valid-access-token",
  "refresh_token": "valid-refresh-token",
  "token_type": "Bearer",
  "expires_at": 4102444800000,
  "scopes": ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
  "saved_at": "2024-01-01T00:00:00.000Z"
}
```

### should send model, store:false, stream, a bearer token and the executeAux4 tool

```timeout
15000
```

```execute
HOME=./chatgpt-home-shape AUX4_CHATGPT_RESOURCE=http://127.0.0.1:8931 aux4 ai agent ask --model '{"api":"chatgpt","config":{"model":"mock-chatgpt-model"}}' "say hi"
```

```expect
VALID:valid-access-token
```

## token refresh on expiry

```file:chatgpt-home-refresh/.config/aux4-ai-agent/chatgpt-auth.json
{
  "issuer": "http://127.0.0.1:8931",
  "subject": "sub-123",
  "email": "person@example.com",
  "name": "Test Person",
  "client_id": "test-client-id",
  "ext_agent_host_id": "urn:uuid:test-host",
  "id_token": "fake.id.token",
  "access_token": "stale-access-token",
  "refresh_token": "stale-refresh-token",
  "token_type": "Bearer",
  "expires_at": 1,
  "scopes": ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
  "saved_at": "2024-01-01T00:00:00.000Z"
}
```

### should refresh the expired token before calling the API, and persist the new tokens

```timeout
15000
```

```execute
HOME=./chatgpt-home-refresh AUX4_CHATGPT_ISSUER=http://127.0.0.1:8931 AUX4_CHATGPT_RESOURCE=http://127.0.0.1:8931 aux4 ai agent auth models && cat ./chatgpt-home-refresh/.config/aux4-ai-agent/chatgpt-auth.json
```

```expect:partial
model-a	Model A
**refreshed-refresh-token-xyz*
```

## not signed in

### should give a clear error instead of attempting a request

```execute
HOME=./chatgpt-home-none aux4 ai agent ask --model '{"api":"chatgpt","config":{"model":"mock-chatgpt-model"}}' "say hi"
```

```error:partial
Prompt error: ChatGPT sign-in not found. Run 'aux4 ai agent auth login' first.
```
