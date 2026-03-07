import { spawn } from "node:child_process";
import { createRequire } from "node:module";

function formatMelbourneNow() {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const label = formatMelbourneNow();
const env = {
  ...process.env,
  NEXT_PUBLIC_BUILD_LABEL: label,
};

console.log(`Deploy label: ${label}`);

const child = spawn(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
