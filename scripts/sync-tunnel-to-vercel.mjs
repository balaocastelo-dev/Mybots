/**
 * Quando o quick tunnel muda de URL, atualiza:
 * - MYBOTS_TUNNEL_HUB no projeto balao2026 (production+preview)
 * - item hubUrl do Edge Config mybots-tunnel
 * - dispara redeploy de production
 *
 * Precisa de MYBOTS_VERCEL_TOKEN ou VERCEL_TOKEN no .env do Hub (nunca loga o valor).
 * Uso: node scripts/sync-tunnel-to-vercel.mjs [urlOpcional]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const TEAM = "team_Mdwt9HWMVtQuaVPBUajlME76";
const PROJECT = "prj_fSMHcxAjmjgMgbgqV6rWhJC7DDFM";
const ENV_ID = "JV9189Afile52MnP"; // MYBOTS_TUNNEL_HUB
const EDGE_CFG = "ecfg_80fy16piuyatppwr2crhryfoeq0b";

function loadEnv() {
  const envPath = path.join(raiz, ".env");
  const map = {};
  if (!fs.existsSync(envPath)) return map;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    map[k] = v;
  }
  return map;
}

function log(m) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(path.join(raiz, "watchdog-online.log"), `[${stamp}] SYNC ${m}\n`);
  console.log(m);
}

async function api(token, method, urlPath, body) {
  const res = await fetch(`https://api.vercel.com${urlPath}${urlPath.includes("?") ? "&" : "?"}teamId=${TEAM}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text.slice(0, 200);
    throw new Error(`${method} ${urlPath} -> ${res.status} ${msg}`);
  }
  return json;
}

function normalizeHubUrl(raw) {
  let u = String(raw || "").trim().replace(/\/$/, "");
  if (!u) throw new Error("URL_EMPTY");
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(u) && !u.includes("/mybots")) {
    // allow full hub path or base
  }
  if (!u.endsWith("/mybots")) u = `${u}/mybots`;
  return u;
}

async function main() {
  const env = loadEnv();
  const token = env.MYBOTS_VERCEL_TOKEN || env.VERCEL_TOKEN;
  if (!token) {
    log("SKIP no MYBOTS_VERCEL_TOKEN/VERCEL_TOKEN in Hub .env");
    process.exit(3);
  }
  const fromArg = process.argv[2];
  const fromFile = fs.existsSync(path.join(raiz, "tunnel-url.txt"))
    ? fs.readFileSync(path.join(raiz, "tunnel-url.txt"), "utf8").trim()
    : "";
  const hubUrl = normalizeHubUrl(fromArg || fromFile || env.MYBOTS_TUNNEL_URL || "");
  log(`TARGET=${hubUrl.replace(/^https:\/\//, "")}`);

  await api(token, "PATCH", `/v9/projects/${PROJECT}/env/${ENV_ID}`, {
    value: hubUrl,
    target: ["production", "preview"],
    comment: "Hub MyBots via Cloudflare tunnel. Watchdog updates when URL changes.",
  });
  log("ENV_OK MYBOTS_TUNNEL_HUB");

  await api(token, "PATCH", `/v1/edge-config/${EDGE_CFG}/items`, {
    items: [{ operation: "upsert", key: "hubUrl", value: hubUrl }],
  });
  log("EDGE_OK hubUrl");

  const dep = await api(token, "POST", "/v13/deployments", {
    name: "balao2026",
    project: PROJECT,
    target: "production",
    gitSource: {
      type: "github",
      org: "balaocastelo-dev",
      repo: "balao2026",
      ref: "main",
    },
  });
  log(`REDEPLOY id=${dep.id || dep.uid || "?"} state=${dep.readyState || dep.state || "?"}`);

  const flag = path.join(raiz, "tunnel-url-changed.flag");
  if (fs.existsSync(flag)) fs.unlinkSync(flag);
  log("DONE");
}

main().catch((e) => {
  log("FAIL " + e.message);
  process.exit(1);
});
