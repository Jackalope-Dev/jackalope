# 🐇 Jackalope

> **High-performance, cross-platform desktop harness and orchestration shell for autonomous AI agents.**

Jackalope is an open-source desktop control plane built with **Tauri v2 + Rust** and **React 19 + Tailwind CSS + Radix UI + Motion**. It provides a flat, tactile user interface with dynamic Arc/Zen-style color palettes, subtle surface elevations, an animated Jackalope mascot pet, and native capabilities to manage projects, spin out isolated git worktrees, auto-refine prompts, orchestrate agent fleets, and visualize codebases.

---

## ✨ Core Highlights

- **⚡ Native Performance & Low Footprint**: Powered by Tauri v2 and Rust. Uses negligible system resources compared to traditional Electron wrappers.
- **🎨 Arc / Zen Style Dynamic Theming**: Fluid color wheel and curated palette system deriving dynamic CSS variables, accent luminescences, and surface tinting in real-time.
- **🐇 Animated Jackalope Companion**: An interactive silhouette mascot living inside the app with reactive states (idle, breathing, thinking, working, celebration).
- **🌿 Git Worktree & Task Dispatch**: Instantly spin out isolated worktrees for concurrent agent workflows without disturbing active branches.
- **🎯 Proactive Meta-Prompt Refiner**: Detects intent, spots ambiguities, and asks clarifying questions before dispatching work to agents.
- **📋 Per-Project Kanban**: Full task lifecycle tracking (Backlog, Refinement, In Progress, Verification, Done) with one-click agent assignment.
- **🗺️ Codebase Visualizer**: Interactive topology map showing repository modules, active worktrees, and running agent processes.
- **🌐 Open & Extensible**: Modular agent adapter layer supporting CLI runners (Claude Code, Aider, OpenHands, Antigravity, Ollama) and standardized ACP (Agent Client Protocol).

---

## 📂 Repository Structure

```
jackalope/
├── apps/
│   └── desktop/               # Tauri v2 native desktop shell & React client
│       ├── src-tauri/         # Rust backend (IPC, Git worktrees, process harness)
│       └── src/               # React 19 UI, theme engine, mascots, kanban, worktrees
├── docs/                      # In-project docs and agent handoff loop
│   ├── AGENTS.md              # Operational guide for AI agents working in this repo
│   ├── STATUS.md              # Live status, completed features, active focus
│   ├── ROADMAP.md             # Multi-phase milestone roadmap
│   ├── TODO.md                # Prioritized backlog of tasks
│   ├── ARCHITECTURE.md        # Technical architecture, IPC protocols, and data models
│   └── DESIGN.md              # Visual/UX direction and mascot-logo guidance
├── pnpm-workspace.yaml        # Monorepo workspace configuration
└── package.json
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v20+ recommended, v24+ supported)
- **pnpm** (v9+ or v10+)
- **Rust & Cargo** (for Tauri desktop runtime):
  - On Windows: `winget install Rustlang.Rustup` or run `rustup-init.exe` from [rustup.rs](https://rustup.rs/)

### Web / UI Development Mode

To quickly develop and preview the frontend and mock Tauri IPC bridges in your browser:

```bash
pnpm install
pnpm dev
```

Visit `http://localhost:5173` to interact with the full UI, theme selector, Jackalope mascot, onboarding wizard, and kanban board.

### Native Desktop Mode

Once Rust is installed:

```bash
pnpm tauri dev
```

---

## 🤖 Agent Loop & Workflow

Jackalope contains an active agent orchestration loop designed so any AI agent can pick up context, make verifiable progress, and hand off work cleanly:
- Consult [`docs/AGENTS.md`](docs/AGENTS.md) for conventions, rules of engagement, and commit hygiene.
- Check [`docs/STATUS.md`](docs/STATUS.md) for immediate tasks and milestones.

---

## 📜 License

Licensed under the [Apache License, Version 2.0](LICENSE).
