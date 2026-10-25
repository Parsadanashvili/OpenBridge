// Run the complete app in a disposable workspace. Browser tests never write to
// the developer's tenant data, audit output, or running simulator instances.
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openbridge-ui-"));
const serverPort = Number(process.env.UI_TEST_PORT || 4400);
const selftest = process.argv.includes("--selftest");
let child;
let closing = false;

function cleanup() {
  fs.rmSync(temp, { recursive: true, force: true });
}
function close() {
  if (closing) return;
  closing = true;
  if (child) child.kill("SIGTERM");
  else {
    cleanup();
    process.exit(0);
  }
}
process.on("SIGINT", close);
process.on("SIGTERM", close);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

(async () => {
  for (const dir of ["src", "config", ...(selftest ? ["scripts"] : [])])
    fs.cpSync(path.join(ROOT, dir), path.join(temp, dir), { recursive: true });
  for (const dir of ["node_modules", "fixtures", "specs", "dist", "docs"])
    fs.symlinkSync(path.join(ROOT, dir), path.join(temp, dir), "dir");
  const ports = { alpha: await freePort(), beta: await freePort() };
  const profilesFile = path.join(temp, "src/banks/profiles.js");
  const original = fs.readFileSync(profilesFile, "utf8");
  fs.writeFileSync(
    profilesFile,
    original
      .replace("port: 4101", `port: ${ports.alpha}`)
      .replace("port: 4102", `port: ${ports.beta}`),
  );
  const configFile = path.join(temp, "config/banks.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  for (const bank of config.banks)
    if (ports[bank.id]) {
      bank.baseUrl = `http://127.0.0.1:${ports[bank.id]}`;
      bank.tokenUrl = `${bank.baseUrl}/oauth/token`;
    }
  fs.writeFileSync(configFile, JSON.stringify(config));
  // Keep optional external AI disabled in acceptance tests.
  child = spawn(
    process.execPath,
    [selftest ? "scripts/selftest.js" : "src/server.js"],
    {
      cwd: temp,
      env: { ...process.env, PORT: String(serverPort), ANTHROPIC_API_KEY: "" },
      stdio: "inherit",
    },
  );
  child.on("exit", (code) => {
    cleanup();
    process.exit(code || 0);
  });
})().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
