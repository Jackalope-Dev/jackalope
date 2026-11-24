---
title: "Coding Agent Sandboxing With Boundaries You Can Test"
description: "Coding agent sandboxing needs enforceable boundaries; choose an isolation method, restrict files and network access, and test what stays blocked."
author: "caden-sumner"
date: 2026-11-24
slug: "coding-agent-sandboxing"
tags: ["coding agents", "sandboxing", "security", "containers"]
image: "https://app.lopebase.com/api/content/images/dc4f1188-7994-4baa-866d-706e3e48c520/cover-3a63dab5d8893dc8.png"
image_alt: "Coding Agent Sandboxing With Boundaries You Can Test"
image_kind: "title_card"
faq: [{"q":"Does a Git Worktree Sandbox a Coding Agent?","a":"No. A worktree separates working files. Use an execution boundary to restrict what the process can read, write, or reach."},{"q":"Is a Docker Container Enough for Untrusted Code?","a":"It depends on the configuration and threat model. Avoid privileged execution, broad host mounts, and access to the Docker daemon. For suspected hostile code, prefer a disposable virtual machine with restricted host integration."},{"q":"Can a Sandboxed Agent Still Read Secrets?","a":"Yes, if its effective read policy, environment, or mounted files expose them. Test read restrictions separately from write restrictions, and keep sensitive files out of the task environment."},{"q":"Can You Block Shell Networking Without Blocking the Agent?","a":"Yes, when the agent separates its model connection from sandboxed shell execution. Verify that scope in its documentation. A network restriction on shell commands doesn't automatically cover every other tool the agent can call."}]
---

Coding agent sandboxing should limit the damage a command can do, even when the agent chooses the wrong command. Start by deciding what must remain unreachable, then test that boundary before you give the agent real work.

Use the choices below to pick an isolation level, build a restricted execution environment, and check that blocked operations actually fail.

## Choose a Boundary That Fits the Code You Will Run

For familiar code, start with your agent's native sandbox and inspect its effective restrictions. For unfamiliar dependencies or repository scripts, prefer a restricted container. For code you suspect is hostile, choose a disposable virtual machine with minimal host integration.

| Approach | Pick it for | Main tradeoff | First check |
| --- | --- | --- | --- |
| Native agent sandbox | Routine changes in a familiar repository | Coverage depends on the agent, configuration, and execution path | Which commands and tools actually run inside it? |
| Restricted container | Unfamiliar build scripts or dependencies | Mounts and runtime privileges need deliberate configuration | Can it reach anything beyond the assigned files? |
| Disposable virtual machine | Suspected hostile code or a requirement for a separate guest kernel | More environment setup and maintenance | Are shared folders and network routes restricted? |

These are recommended starting points, not security ratings. Docker's [container explanation](https://docs.docker.com/learn/content/what-is-a-container/) describes the underlying distinction between containers, which share a kernel, and virtual machines, which have their own guest operating system.

### Native Agent Sandbox

A native sandbox applies execution restrictions through the agent's own runtime. It fits familiar repositories where you need ordinary development tools without rebuilding your environment.

**Best for:** Routine work when you understand the sandbox's scope.

For example, Claude Code exposes its sandbox controls through `/sandbox`. Its [sandbox documentation](https://code.claude.com/docs/en/sandboxing) explains an important limit: the sandbox wraps shell commands and their child processes, while built-in file and web tools operate outside that shell boundary. Inspect exclusions, unsandboxed retries, and what happens if sandbox startup fails.

Codex supports `codex --sandbox workspace-write`, documented in its [agent security guide](https://developers.openai.com/codex/security/). Treat workspace write restrictions separately from read restrictions. A setting that limits writes doesn't establish that unrelated files are unreadable.

### Restricted Container

A container gives the process a configured filesystem, network environment, and set of runtime privileges. It fits tasks where you want an explicit environment with only selected host files exposed.

**Best for:** Running unfamiliar project commands without exposing your normal development environment.

For example, expose one disposable project directory at `/workspace`, omit home-directory mounts, and start without networking. Keep the Docker control socket out of the container. Docker's [security documentation](https://docs.docker.com/engine/security/) explains why control of the daemon is powerful and why mounts, capabilities, and kernel vulnerabilities matter to isolation.

### Disposable Virtual Machine

A virtual machine puts the task inside a separate guest operating system. Choose it when sharing the container runtime's kernel is outside your acceptable risk boundary.

**Best for:** Suspected hostile repositories or tasks that need a separately disposable machine.

For example, create a clean guest, copy in the source, restrict its network, and avoid shared host folders. Export only the source changes you intend to inspect. The tradeoff is maintaining another operating system and toolchain. A separate guest kernel doesn't justify broad host sharing.

## Define Reads, Writes, and Network Access Separately

Write down the intended access before configuring the sandbox. A useful task policy is specific enough to test:

```text
Source: one disposable project copy
Reads: project files and installed toolchain
Writes: project copy and temporary storage
Network during execution: disabled
Host integration: no home mount or Docker socket
Output: source changes, test output, and build logs
```

Pay particular attention to reads. OpenAI's [explanation of the Codex sandbox](https://openai.com/index/inside-the-codex-sandbox/) describes how broad filesystem reads can remain available even when writes are restricted. The same explanation notes that sandboxed writes to ignored dependencies can become dangerous if a host-side editor later executes those files.

Choose writable paths by purpose. Keep scratch output disposable, and avoid sharing dependency directories between the restricted environment and host-side tools. If the task needs reference files, expose only those files and make them read-only where possible. Docker's [bind-mount documentation](https://docs.docker.com/engine/storage/bind-mounts/) confirms that bind mounts are writable by default and can modify host files directly.

Don't put secrets inside the source directory and expect the surrounding sandbox to hide them. For secret placement and access scope, use the [credential management checklist](https://jackalope.dev/blog/coding-agent-credential-management-checklist/).

## Start With an Offline Execution Environment

Separate environment preparation from task execution. Prepare a reviewed image with the required runtime and dependencies, then run the task with narrower access. Don't make unrestricted package downloads a permanent condition of every test run.

The following is a boundary demonstration for Linux containers from a non-root POSIX shell with Docker installed. Run it from a disposable directory containing no sensitive files. Alpine provides a small shell environment here, not a configured coding agent or project toolchain.

```sh
docker pull alpine

docker run --rm -it \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges=true \
  --user "$(id -u):$(id -g)" \
  --pids-limit 256 \
  --memory 2g \
  --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777 \
  --env HOME=/tmp \
  --mount "type=bind,src=$(pwd),dst=/workspace" \
  --workdir /workspace \
  alpine sh
```

Docker's [run reference](https://docs.docker.com/reference/cli/docker/container/run/) documents these controls. The root filesystem is read-only; the project mount and temporary storage remain writable. Capabilities are dropped, privilege gains are restricted, and CPU, memory, and process limits are explicit. The example resource limits are starting values, not measured requirements.

Replace Alpine with your reviewed project image for actual work. Keep the restrictions, then adjust individual limits only when the task requires it. Docker's [none network driver](https://docs.docker.com/engine/network/drivers/none/) leaves only loopback networking inside the container.

This example isolates the shell it launches. It doesn't sandbox an agent still running on your host. To contain the whole agent process, launch that process inside the chosen boundary. An offline environment also cannot provide an agent's remote model connection, so whole-agent containment needs narrowly controlled outbound access rather than this fully offline configuration.

## Verify Denials Through the Actual Execution Path

Test the boundary through the same mechanism the agent will use. A successful check in your host terminal says nothing about the agent's restricted process.

Inside the demonstration container, run:

```sh
id
printf 'sandbox probe\n' > /workspace/.sandbox-write-probe
cat /workspace/.sandbox-write-probe
rm /workspace/.sandbox-write-probe
touch /sandbox-root-probe
test ! -e /var/run/docker.sock && echo 'Docker socket absent'
```

The workspace write should succeed. The root-level `touch` should fail, and the socket check should report absence. These expectations follow from the command's mounts and filesystem restrictions; they don't establish that every possible escape is blocked.

Add checks for your actual policy:

- Place a harmless canary outside the assigned source directory and test that it cannot be read if read isolation is required.
- Test an allowed network destination and a denied destination when you use an outbound allowlist.
- Confirm that a blocked operation stays blocked rather than being retried outside the boundary.
- Run one representative build or test to confirm that useful work still succeeds.

Record the configuration alongside the results. Repeat these checks after changing mounts, network policy, runtime privileges, or agent execution paths.

## Keep Worktrees Outside Your Security Assumptions

A separate checkout solves file coordination, not process containment. The [Git worktree guide](https://jackalope.dev/blog/git-worktrees-for-ai-coding-agents/) covers that distinction and the underlying checkout setup.

When you put a task directory inside a sandbox, avoid widening access to your whole development folder simply to make Git metadata available. Prefer a self-contained disposable checkout when that keeps the boundary easier to understand.

### Use Jackalope for Task Coordination

Jackalope gives each task its own Git worktree so you can run coding agents side by side. Routine agent permission requests are answered by a risk check, while risky requests still ask you. Finished work comes back with its checks and evidence for review.

Keep those workflow controls separate from your sandbox policy. A worktree organizes changes, and a permission decision governs a request. Neither establishes which files or network destinations the resulting process can reach. Verify those boundaries through the actual execution path before starting parallel tasks.

For your next task, choose one harmless repository and define one allowed write, one forbidden write, one forbidden read, and one forbidden network destination. Test all four through the intended agent execution path before you expose valuable source or run unfamiliar scripts.

## FAQ

### Does a Git Worktree Sandbox a Coding Agent?

No. A worktree separates working files. Use an execution boundary to restrict what the process can read, write, or reach.

### Is a Docker Container Enough for Untrusted Code?

It depends on the configuration and threat model. Avoid privileged execution, broad host mounts, and access to the Docker daemon. For suspected hostile code, prefer a disposable virtual machine with restricted host integration.

### Can a Sandboxed Agent Still Read Secrets?

Yes, if its effective read policy, environment, or mounted files expose them. Test read restrictions separately from write restrictions, and keep sensitive files out of the task environment.

### Can You Block Shell Networking Without Blocking the Agent?

Yes, when the agent separates its model connection from sandboxed shell execution. Verify that scope in its documentation. A network restriction on shell commands doesn't automatically cover every other tool the agent can call.
