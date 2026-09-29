#!/usr/bin/env node
/** اجرای پلتفرم مستقل کلبه: PostgreSQL + Next.js. */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? process.env.ComSpec ?? "cmd.exe" : "npm";
const npmArgs = (args) => isWindows ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args;

const postgres = spawnSync(process.execPath, ["scripts/pg.mjs", "ensure"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (postgres.status !== 0) {
  console.error("PostgreSQL بالا نیامد؛ اجرای برنامه متوقف شد.");
  process.exit(postgres.status ?? 1);
}

console.log("\nکلبه وینتیج — Next.js + PostgreSQL");
const child = spawn(npmCommand, npmArgs(["run", "dev", "--workspace", "kolbe-next"]), {
  cwd: ROOT,
  env: process.env,
  stdio: "inherit",
});
child.on("error", (error) => console.error(error.message));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { if (!child.killed) child.kill(signal); });
}
child.on("exit", (code) => { process.exitCode = code ?? 0; });
