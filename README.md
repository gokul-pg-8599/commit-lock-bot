# Commit Lock Bot

A collaborative commit lock system for teams using Git submodules. Prevents parent repo submodule pointer conflicts by ensuring only one developer commits at a time.

## Problem

When multiple developers work on different submodules and update the parent repo's submodule pointers simultaneously, merge conflicts occur. This bot introduces a mutual-exclusion lock — one developer at a time — managed entirely through Zoho Cliq slash commands.

## Features

- **Slash command lock management** — `/zswcheckin`, `/zswcheckout`, `/zswlockstatus`, `/zswforcerelease`
- **Queue system** — developers who try to check in while the lock is held are added to a waiting queue
- **Auto-release timeout** — lock automatically releases after a configurable timeout (default: 59 min) to prevent forgotten locks from blocking the team
- **Commit message tracking** — optional message when checking in so the team knows what's being committed
- **Force release** — admin-only command to forcibly release a stuck lock
- **Channel notifications** — optional webhook posts lock/release events to a Cliq channel for team visibility
- **Git hook enforcement** — pre-commit hook blocks commits if the developer hasn't acquired the lock
- **Serverless** — runs on Zoho Catalyst with zero infrastructure to manage

## Slash Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/zswcheckin [message]` | Acquire the commit lock | `/zswcheckin fixing navbar styles` |
| `/zswcheckout` | Release the commit lock | `/zswcheckout` |
| `/zswlockstatus` | Check who holds the lock | `/zswlockstatus` |
| `/zswforcerelease [key]` | Force release (admin only) | `/zswforcerelease myAdminKey` |

## Architecture

```
Developer (Cliq)                    Zoho Catalyst
    |                                    |
    |--- /zswcheckin -----> Deluge ---> Catalyst Function (Express.js)
    |                                    |
    |                               DataStore (CommitLock table)
    |                                    |
    |<-- { text: "Lock acquired" } ------+
    |
    |--- git commit ------> pre-commit hook
    |                           |
    |                           +--- curl /status ---> Catalyst Function
    |                           |
    |                      (blocks if lock not held by this user)
```

### Tech Stack

- **Runtime**: Zoho Catalyst Advanced I/O Function (Node.js 18)
- **Framework**: Express.js
- **State storage**: Catalyst DataStore (single-row singleton pattern)
- **Query layer**: ZCQL (Catalyst SQL) for reads, DataStore SDK for writes
- **Cliq integration**: Deluge slash command handlers calling the Catalyst function via `invokeurl`
- **Notifications**: Outbound webhook to Cliq channel (optional)

### Key Design Decisions

- **ZCQL for reads**: The DataStore SDK's `getPagedRows()` returns a wrapped response format. ZCQL provides a more predictable array-of-objects response.
- **Timestamp-based auto-release**: Serverless functions can't use `setTimeout`. Instead, every read checks if `lastActivity` exceeds the timeout threshold and auto-releases expired locks.
- **Single-row singleton**: All lock state lives in one DataStore row. First request creates it via `insertRow`; all subsequent requests use `updateRow` with the stored `ROWID`.
- **User identity from Cliq**: The `user.email` field from Cliq's slash command payload identifies developers. Git hooks default to `git config user.email` for consistency.

## Project Structure

```
commit-lock-system/
+-- functions/
|   +-- commit_lock_function/
|       +-- index.js           # Express routes for all endpoints
|       +-- lock-store.js      # DataStore CRUD + lock logic
|       +-- cliq.js            # Response builders + webhook notifications
|       +-- package.json       # express, zcatalyst-sdk-node
|       +-- catalyst-config.json
+-- hooks/
|   +-- pre-commit             # Git hook — blocks commit if lock not held
|   +-- post-commit
|   +-- install-hooks.sh       # One-command hook installer
+-- scripts/
|   +-- setup-windows.bat
|   +-- start-server.bat
+-- catalyst.json              # Catalyst project config
+-- .catalystrc                # Catalyst project link (auto-generated)
+-- .commit-lock-config.example
+-- .gitignore
+-- .gitattributes
```

## Setup Guide

### Prerequisites

- Zoho Catalyst account
- Zoho Cliq access (organization level)
- Node.js 18+
- Catalyst CLI (`npm install -g zcatalyst-cli`)

### 1. Catalyst Project

```bash
catalyst login
catalyst init    # Select your project, choose Functions > Advanced I/O > Node.js 18
catalyst deploy --only functions
```

### 2. DataStore Table

In Catalyst Console > DataStore > Create Table:

- **Table name**: `CommitLock`
- **Columns** (all String/text type): `locked`, `holder`, `since`, `commitMessage`, `queue`, `lastActivity`

### 3. Environment Variables

In Catalyst Console > Functions > `commit_lock_function` > Configuration:

| Variable | Value | Required |
|----------|-------|----------|
| `LOCK_TIMEOUT_MINUTES` | `59` | No (defaults to 30) |
| `ADMIN_KEY` | Any secret string | For `/zswforcerelease` |
| `CLIQ_NOTIFY_URL` | Cliq channel webhook URL | For channel notifications |

### 4. Cliq Slash Commands

In Cliq > Integrations > Commands, create 4 commands with Deluge handlers that call:

- `POST <catalyst-function-url>/cliq/checkin`
- `POST <catalyst-function-url>/cliq/checkout`
- `POST <catalyst-function-url>/cliq/status`
- `POST <catalyst-function-url>/cliq/force`

Each Deluge handler sends user info and command arguments as JSON to the Catalyst function and returns the response.

### 5. Git Hooks (per developer)

```bash
# From the parent repo root
bash commit-lock-system/hooks/install-hooks.sh

# Set the Catalyst function URL (add to shell profile)
export COMMIT_LOCK_SERVER=https://<your-catalyst-url>/server/commit_lock_function
```

The pre-commit hook automatically uses `git config user.email` to identify the developer.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Health check |
| `GET` | `/status` | Lock status (used by git hooks) |
| `GET` | `/debug` | Raw DataStore response (troubleshooting) |
| `POST` | `/cliq/checkin` | Acquire lock (Cliq slash command) |
| `POST` | `/cliq/checkout` | Release lock (Cliq slash command) |
| `POST` | `/cliq/status` | Lock status card (Cliq slash command) |
| `POST` | `/cliq/force` | Force release (Cliq slash command) |

## Typical Workflow

1. Developer types `/zswcheckin updating user module` in Cliq
2. Bot responds: "You now hold the commit lock"
3. Developer commits to their submodule and pushes
4. Developer updates parent repo submodule pointer and commits
5. Developer types `/zswcheckout` in Cliq
6. Bot responds: "Lock released" and notifies the next person in queue

## License

MIT
