# ⚡ asistenku

**Multi-provider AI coding CLI** — open source, file-based memory, bikinan anak Indonesia 🇮🇩

Claude Code / Gemini CLI / Kiro-inspired coding assistant yang jalan di terminal kamu.
Multi-provider out of the box (Claude, GPT, Gemini, DeepSeek, Ollama local, dan lainnya).

## ✨ Features (v0.1.0 — MVP)

- 🤖 **Multi-provider** — Anthropic Claude, OpenAI GPT, Google Gemini, DeepSeek, Ollama local, OpenRouter, Groq
- 🧠 **File-based memory** — `ASISTENKU.md` per project + global
- 💾 **Session persistence** — auto-save every turn, resume anytime
- 🛠 **Built-in tools** — read/write/edit files, bash, grep, glob, todo list
- 🔐 **Permission modes** — ask, auto, yolo, read-only
- 📊 **Context visualization** — track tokens + cost in realtime
- 💬 **Streaming output** — live response rendering
- 🎨 **Rich TUI** — Ink-based, markdown rendering, syntax highlighting
- ⚡ **Fast** — Bun runtime, SQLite storage

## 📦 Installation

### Option 1: Single binary (recommended)

```bash
# Linux x64
curl -L https://github.com/zesbe/asistenku/releases/latest/download/asistenku-linux-x64 -o /usr/local/bin/asistenku
chmod +x /usr/local/bin/asistenku

# macOS Apple Silicon
curl -L https://github.com/zesbe/asistenku/releases/latest/download/asistenku-darwin-arm64 -o /usr/local/bin/asistenku
chmod +x /usr/local/bin/asistenku

# Windows (PowerShell)
iwr https://github.com/zesbe/asistenku/releases/latest/download/asistenku-windows-x64.exe -OutFile $env:USERPROFILE\asistenku.exe
```

### Option 2: From source

```bash
git clone https://github.com/zesbe/asistenku
cd asistenku
bun install
bun run build
# Single binary: ./dist/asistenku
```

### Option 3: Run via Bun (dev)

```bash
bun install
bun run src/cli.ts
```

## 🚀 Quick Start

```bash
# 1. Login to a provider
asistenku login anthropic
# enter API key when prompted

# 2. Start chatting
asistenku

# 3. Or one-shot query
asistenku "explain this codebase"

# 4. Resume last session
asistenku --resume
```

## 🎮 Commands

### CLI subcommands

```bash
asistenku [prompt]          # Start interactive chat
asistenku login <provider>  # Configure API key
asistenku logout            # Remove API keys
asistenku sessions          # List saved sessions
asistenku models            # List available models
asistenku doctor            # Diagnose config + environment
```

### In-session slash commands (MVP — 15+ commands)

```
/help, /h, /?          — Show commands
/exit, /quit, /q       — Exit
/clear, /reset, /new   — Fresh conversation
/model [prov/model]    — Switch model
/config, /settings     — View config
/context               — Show context usage + cost
/sessions, /list       — List recent sessions
/memory [init]         — View/init ASISTENKU.md
/tools                 — List available tools
/permissions, /perms   — Show permission rules
/todos                 — Show todo list
/cost, /usage          — Session cost + tokens
/init                  — Init project memory
/doctor                — Diagnose
/save [file]           — Export session
```

## 🧠 Memory System

Asistenku remembers context through markdown files:

```
~/.asistenku/ASISTENKU.md  ← Global memory (all projects)
./ASISTENKU.md              ← Project memory (current dir)
```

Both files are loaded into system prompt at session start.

Use `remember` tool in-session (or edit the files directly):

```
You: "Remember that I prefer 2-space indentation"
asistenku: [uses remember tool → appends to ASISTENKU.md]
```

## 🛠 Tools

| Tool | Category | Safety | Description |
|------|----------|--------|-------------|
| `read_file` | file | 👁 read-only | Read file content |
| `write_file` | file | ⚠ dangerous | Create/overwrite file |
| `edit_file` | file | ⚠ dangerous | Replace text in file |
| `list_dir` | file | 👁 | List directory |
| `delete_file` | file | ⚠ | Remove file/dir |
| `grep` | search | 👁 | Regex search content |
| `glob` | search | 👁 | Find files by pattern |
| `bash` | shell | ⚠ | Execute shell commands |
| `remember` | memory | — | Save to ASISTENKU.md |
| `todo` | memory | — | Manage session todos |

## 🔐 Permission Modes

| Mode | Behavior |
|------|----------|
| `ask` | Prompt for each tool (default) |
| `auto` | Auto-approve safe tools, ask for dangerous |
| `yolo` | Auto-approve everything (⚠ dangerous) |
| `read-only` | Block all write/exec tools |

Set via `/permissions` or `--trust-all-tools` flag.

## 🔌 Providers

Set API keys via `asistenku login <provider>` or environment variables:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AI...
export DEEPSEEK_API_KEY=sk-...
export GROQ_API_KEY=gsk_...
export OPENROUTER_API_KEY=sk-or-...

# Ollama (local, no key needed)
# Default: http://localhost:11434
```

## 📁 Configuration Files

```
~/.asistenku/config.json    # Global config
~/.asistenku/ASISTENKU.md   # Global memory
~/.asistenku/asistenku.db   # SQLite (sessions + messages)
~/.asistenku/.env           # Global env vars (optional)

./asistenku.config.json     # Project override
./ASISTENKU.md              # Project memory
```

## 🗺 Roadmap

**Phase 1 — Core MVP ✅ (current)**
- ✅ Multi-provider + streaming
- ✅ Tools system
- ✅ SQLite persistence
- ✅ Memory (ASISTENKU.md)
- ✅ Slash commands (15+)
- ✅ Permission engine
- ✅ CLI subcommands
- ✅ TUI with Ink

**Phase 2 — Power Features 🚧**
- [ ] Skills system (markdown auto-triggered)
- [ ] Agents / subagents (specialized personas)
- [ ] MCP client native support
- [ ] Hooks (pre/post tool events)
- [ ] Checkpointing (rewind)
- [ ] Background tasks
- [ ] Git worktree integration
- [ ] Auto-memory (AI writes ASISTENKU.md)
- [ ] Fast mode + effort levels

**Phase 3 — Advanced 📋**
- [ ] Plugin system + marketplace
- [ ] Scheduled routines
- [ ] Multi-agent orchestration
- [ ] Web UI dashboard
- [ ] Remote control (mobile)
- [ ] VS Code extension
- [ ] Cloud sync (optional)
- [ ] Voice dictation

## 🤝 Contributing

Contributions welcome! Especially:
- Additional provider integrations
- Better TUI (themes, keybindings)
- Skills for common dev workflows
- Documentation & examples
- Bug reports & feature requests

See `CONTRIBUTING.md` for guidelines.

## 📜 License

MIT © [zesbe](https://github.com/zesbe)

## 🙏 Inspiration

- **Claude Code** (Anthropic) — agentic loop + slash commands patterns
- **Kiro CLI** (AWS) — skills + MCP architecture
- **Gemini CLI** (Google) — Ink-based TUI approach
- **OpenCode** (SST) — Bun-first open source example
- **Aider** — Python CLI for coding
- **Letta** (formerly MemGPT) — persistent memory concepts

Dibikin dengan ❤️ di Indonesia untuk developer Indonesia (dan dunia!)
