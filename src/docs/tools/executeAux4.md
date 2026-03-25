# Execute Aux4 CLI Tool

Access the complete aux4 ecosystem for advanced project management, AI operations, package management, and development workflows.

## Overview

This tool is your **gateway to the aux4 universe** - a powerful command system that extends far beyond basic file operations. aux4 provides project automation, AI integrations, package management, configuration handling, and much more through its modular command system.

## Parameters

| Parameter | Type   | Required | Description                                                                                                        |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `command` | string | ✅ Yes   | The aux4 command to execute. **Do NOT include** the `aux4` prefix - just provide the nested actions and parameters |
| `stdin`   | string | ❌ No    | Optional data to pass as stdin to the command. Use this for commands that read input from stdin (e.g., `pdf fill`, `pdf form`) |
| `timeout` | number | ❌ No    | Timeout in seconds. Defaults to **60**. Set to `0` to disable timeout. If the command exceeds this limit, it is automatically transferred to a background job (if aux4/jobs is installed) or killed |

## ⏱️ Timeout Behavior

Commands have a **60-second default timeout**. If a command exceeds the timeout:

1. The process is **automatically transferred** to a background job via `aux4 jobs attach` (if aux4/jobs is installed)
2. You receive the **job ID** and can manage it with `jobs status`, `jobs output`, `jobs kill`
3. **Partial output** captured before the timeout is included in the response
4. If aux4/jobs is **not available**, the process is killed and you're told to retry with `jobs run`

**Output handling:**
- All command output (stdout/stderr) is written to temporary files during execution
- If output exceeds ~50KB, it is **truncated** in the response with a pointer to the full file
- On timeout with job attachment, output files are **symlinked** into the job directory — use `jobs output <id>` to read them

**When to adjust the timeout:**
- Most commands (config, file ops, lookups) finish in seconds — the default is fine
- For commands that may take longer (large file processing, API calls), increase the timeout
- Set `timeout: 0` to disable the timeout entirely (use with caution)

**When to use `aux4 jobs run` proactively:**
- Builds, deployments, test suites, and other known long-running processes
- Use `jobs run` directly instead of waiting for the timeout to fire

## 📥 Passing Data via stdin

Some aux4 commands read structured data from stdin (e.g., `pdf fill` reads JSON field values). Use the `stdin` parameter to pipe data into these commands:

```
executeAux4({
  command: 'pdf fill "form.pdf" --out "filled.pdf"',
  stdin: '{"field1": "value1", "field2": "value2"}'
})
```

**When to use `stdin`:**
- Commands that expect piped input (indicated by `stdin:` prefix in their `.aux4` definition)
- Passing JSON data to commands like `pdf fill` or `pdf form`
- Any command that reads from standard input

**Do NOT use shell pipes or redirects** — use the `stdin` parameter instead.

## ⚠️ Important: Command Format

**✅ Correct:** Use only the nested command parts

```
"config get database/host"
"pkger list --showDependencies"
"ai chat --model gpt-4"
```

**❌ Incorrect:** Don't include the aux4 prefix

```
"aux4 config get database/host"    # ❌ Wrong
"aux4 pkger list"                  # ❌ Wrong
```

## aux4 Ecosystem Architecture

### 🏗️ **Core System**

aux4 uses `.aux4` configuration files to define commands that can be:

- **Direct shell commands** for project automation
- **Profile redirections** for command organization
- **Built-in aux4 functions** for system operations

### 📦 **Package System**

aux4 includes a complete package manager for installing and managing modular functionality:

- **Package installation:** `pkger install scope/package-name`
- **Package discovery:** `pkger list --filter search-term`
- **Documentation:** `pkger man scope/package-name`

### ⚙️ **Configuration Management**

Robust config system supporting YAML and JSON with hierarchical access:

- **Read values:** `config get section/key`
- **Write values:** `config set --name section/key --value new-value`
- **Environment configs:** Load parameters via `--config dev` or `--config prod`

## 🔍 Command Discovery Process

### 1. **Explore Available Commands**

```
""                    # List all available commands
"--help"              # Get general help
```

### 2. **Get Command-Specific Help**

```
"command-name --help"           # Get help for specific command
"profile-name --help"           # List commands in a profile
"profile-name subcommand --help" # Get help for nested commands
```

### 3. **Verify Before Using**

**🚨 CRITICAL:** Always verify commands exist before calling them

```
"db --help"                 # Check if 'db' profile exists
"db sqlite --help"          # Verify 'sqlite' command in 'db' profile
"config --help"             # Confirm config package is installed
```

### 🔒 **Private Commands**

Some commands are **private** and won't appear in general help listings, but you can still access their help directly:

```
"group --help"                    # Shows public commands only
"group private-command --help"    # Access private command help directly
"private-group --help"            # May not show all subcommands
"private-group private-command --help"  # Access nested private command help
```

**Key points about private commands:**
- **Hidden from listings:** Won't appear when using `--help` on parent groups
- **Directly accessible:** Can still get help and use them if you know the name
- **Documentation available:** Use `--help` directly on the command to see usage
- **Discovery challenge:** Require knowledge of command names or documentation

## 🎯 Common Command Categories

### 📋 **Package Management**

```
"pkger list"                          # List installed packages
"pkger install scope/package-name"    # Install new package
"pkger uninstall scope/package-name"  # Remove package
"pkger man scope/package-name"        # View package documentation
```

### ⚙️ **Configuration Operations**

```
"config get"                    # Get entire configuration
"config get section/key"        # Get specific value
"config set --name key --value val"  # Set configuration value
```

### 🔧 **Built-in Utilities**

```
"source command-name"     # Show command source code
"which command-name"      # Find command location
"man command-name"        # Show command manual
```

## 📚 Configuration File Integration

aux4 supports loading command parameters from `config.yaml` files:

### Configuration Structure

```yaml
config:
  dev:
    host: localhost
    port: 3000
    database: dev_db
  prod:
    host: production.example.com
    port: 8080
    database: prod_db
```

### Usage with --config Flag

```
"deploy --config dev"        # Load dev configuration
"deploy --config prod"       # Load prod configuration
"deploy --configFile custom.yaml --config staging"  # Custom config file
```

## 🚨 Critical Safety Rules

### ✅ **Always Verify First**

```
# CORRECT approach:
1. "tools --help"                           # Check if 'tools' exists
2. "tools docker --help"                    # Verify 'docker' subcommand
3. "tools docker container --help"          # Confirm 'container' action
4. "tools docker container list --help"     # Understand 'list' parameters
5. "tools docker container list"            # Execute verified command
```

### 🔒 **Handling Private Commands**

```
# For suspected private commands:
1. "group suspected-command --help"         # Try direct help access
2. Check documentation or package manuals   # Look for command references
3. "pkger man scope/package-name"           # Check package documentation
```

### ❌ **Never Guess Commands**

```
# WRONG approach:
"db-sqlite execute --sql SELECT"     # ❌ Guessing syntax
"2table --format markdown"           # ❌ Assuming command exists
"secret-command --action"            # ❌ Assuming private commands exist
```

## 📊 Response Format

- **✅ Success:** Returns complete command output (stdout + stderr)
- **❌ Command errors:** Returns formatted error with details
- **❌ Command not found:** Returns command not found error
- **❌ System errors:** Returns system error details

## 🎯 Strategic Usage Examples

### 🔍 **Discovery Workflow**

```
1. ""                     # See what's available
2. "config --help"        # Check config capabilities
3. "config get --help"    # Understand get command
4. "config get database"  # Use verified command
```

### 📦 **Package Exploration**

```
1. "pkger list"                    # See installed packages
2. "pkger man aux4/db-sqlite"      # Read package docs
3. "db --help"                     # Check package commands
4. "db sqlite --help"              # Verify subcommand syntax
```

### ⚙️ **Project Automation**

```
1. "build --help"          # Verify build command exists
2. "build --config dev"    # Run with dev configuration
3. "test --help"           # Check test capabilities
4. "test run --coverage"   # Execute with verified options
```

> **💡 Pro Tip:** aux4's power comes from its modular package system. Always start with discovery commands to understand what's available, then verify syntax before execution. The `--help` flag is your best friend for safe aux4 usage.
