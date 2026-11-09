#### Description

Manage the native Sign in with ChatGPT session used by ai-agent. `login` opens the OAuth flow in your system browser, `models` lists models available to that ChatGPT account, `status` shows the current sign-in, and `logout` revokes and clears the saved session. ChatGPT plan usage applies when `api: chatgpt` is selected in the model configuration.

#### Usage

```bash
aux4 ai agent auth <login|models|status|logout>
```

`action` is required. `models` requires a completed ChatGPT sign-in.

#### Example

Start the browser sign-in flow:

```bash
aux4 ai agent auth login
```

List models available to the signed-in account:

```bash
aux4 ai agent auth models
```

Select a listed model in an agent config with `api: chatgpt`. Sign out when finished:

```bash
aux4 ai agent auth logout
```
