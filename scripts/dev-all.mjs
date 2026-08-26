import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const commands = ["dev:kolbe", "dev:supplier"];
const children = commands.map((script) =>
  spawn(npmCommand, isWindows ? ["/d", "/s", "/c", `npm run ${script}`] : ["run", script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  }),
);

let shuttingDown = false;

function shutdown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!shuttingDown && code && code !== 0) {
      process.exitCode = code;
      shutdown();
    }
  });
}
