// Start headless Chrome and wait until its debugger port answers.
// The port is polled until a longer timeout. If that launch never
// opens the port, it is killed and started once more.
import { spawn } from "node:child_process";

const DEBUG_TIMEOUT_MS = 30000;
const POLL_MS = 250;

export async function waitForDebugger(port, timeoutMs = DEBUG_TIMEOUT_MS, isDead = () => "") {
  const deadline = Date.now() + timeoutMs;
  let last = "port not open";
  while (Date.now() < deadline) {
    const dead = isDead();
    if (dead) throw new Error(`Chrome debugger did not open (${dead})`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`Chrome debugger did not open (${last})`);
}

function argsForAttempt(args, attempt) {
  return args.map((arg) => {
    if (arg.startsWith("--remote-debugging-port=")) {
      const port = Number(arg.slice("--remote-debugging-port=".length)) + attempt;
      return `--remote-debugging-port=${port}`;
    }
    if (arg.startsWith("--user-data-dir=")) return `${arg}-try${attempt}`;
    return arg;
  });
}

export async function launchChrome(chromeBin, args) {
  let lastError = new Error("Chrome debugger did not open (not started)");
  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptArgs = argsForAttempt(args, attempt);
    const proc = spawn(chromeBin, attemptArgs, { stdio: "ignore" });
    const portArg = attemptArgs.find((arg) => arg.startsWith("--remote-debugging-port="));
    const port = Number(portArg.slice("--remote-debugging-port=".length));
    let exitReason = "";
    const onExit = (code) => {
      exitReason = `process exited ${code}`;
    };
    proc.once("exit", onExit);
    try {
      const version = await waitForDebugger(port, DEBUG_TIMEOUT_MS, () => exitReason);
      proc.off("exit", onExit);
      return { proc, version };
    } catch (error) {
      lastError = error;
      proc.off("exit", onExit);
      try { proc.kill("SIGKILL"); } catch (killError) {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}
