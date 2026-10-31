// Um PC por bot: registro estável, sem subir todo mundo, ociosidade e o gancho do celular.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { idDoAndroid, limparProvedoresAndroid, registrarProvedorAndroid, resolverAlvoAndroid } from "../packages/hub/src/android.ts";
import { definirDocker, docker, nomesDeContainerEmpresa, portaIntocavel, portasDaChave, type ExecDocker } from "../packages/hub/src/dockerPc.ts";
import { NAVEGADOR_DO_PC, acessoAberto, acordarPc, abrirTela, botPadraoDaEmpresa, classificarRotaPc, definirAcessoPc, deveParar, espectadores, fecharTela, lerRegistro, listarMaquinas, migrarRegistros, politicaDoPc, registrarPc, varrerOciosos, zerarUsoParaTeste } from "../packages/hub/src/pcs.ts";
import { botsDaPasta, botsDoBanco, executarMigracao } from "../scripts/migrar-pcs-por-bot.ts";

function pasta(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mybots-pcs-"));
}

describe("pc por bot", { concurrency: 1 }, () => {
  test("portas estáveis, migração sem docker e celular plugável", async () => {
    const dir = pasta();
    process.env.MYBOTS_MAQUINAS_DIR = dir;
    delete process.env.MYBOTS_PC_IMAGEM;
    delete process.env.MYBOTS_PC_COMANDO;
    delete process.env.MYBOTS_PC_OCIOSO_MIN;
    zerarUsoParaTeste();
    limparProvedoresAndroid();

    const chamadas: string[][] = [];
    const ligados = new Set<string>();
    const criados = new Set<string>();
    const falso: ExecDocker = async (args) => {
      chamadas.push(args);
      if (args[0] === "info") return { ok: true, saida: "29" };
      if (args[0] === "image") return { ok: true, saida: "sha256:teste" };
      if (args[0] === "inspect") {
        const nome = args[args.length - 1];
        if (!criados.has(nome)) return { ok: false, saida: "no such object" };
        return { ok: true, saida: ligados.has(nome) ? "true" : "false" };
      }
      if (args[0] === "run") {
        const i = args.indexOf("--name");
        const nome = args[i + 1];
        criados.add(nome);
        ligados.add(nome);
        return { ok: true, saida: "id" };
      }
      if (args[0] === "start") { ligados.add(args[1]); return { ok: true, saida: "" }; }
      if (args[0] === "stop") { ligados.delete(args[1]); return { ok: true, saida: "" }; }
      return { ok: true, saida: "" };
    };
    definirDocker(falso);

    try {
      assert.equal(portaIntocavel(8787), true);
      assert.equal(portaIntocavel(8791), true);
      assert.equal(portaIntocavel(7901), false);
      assert.equal(NAVEGADOR_DO_PC.binario, "chromium");
      assert.match(NAVEGADOR_DO_PC.motivo, /Chromium/);
      assert.match(NAVEGADOR_DO_PC.motivo, /Chrome/);

      const empresa = portasDaChave("bot-ana");
      assert.equal(nomesDeContainerEmpresa().has("mybots-bot-ana"), true);
      const ana = registrarPc({ botId: "ana", empresaId: "balao", nome: "Ana" });
      assert.notEqual(ana.container, "mybots-bot-ana");
      assert.match(ana.container, /^mybots-bot-/);
      assert.notEqual(ana.portaTela, empresa.portaTela);
      assert.notEqual(ana.portaCdp, empresa.portaCdp);
      assert.equal(ana.android.rota, "/android/ana/");
      const deNovo = registrarPc({ botId: "ana", empresaId: "balao", nome: "Ana Silva" });
      assert.equal(deNovo.portaTela, ana.portaTela);
      assert.equal(deNovo.portaCdp, ana.portaCdp);
      assert.equal(deNovo.container, ana.container);
      assert.equal(deNovo.nome, "Ana Silva");

      const antigo = path.join(dir, "balao", "perfil.txt");
      fs.mkdirSync(path.dirname(antigo), { recursive: true });
      fs.writeFileSync(antigo, "login-que-fica");

      const bots = Array.from({ length: 23 }, (_, i) => ({
        id: `bot-${String(i + 1).padStart(2, "0")}`,
        nome: `Bot ${i + 1}`,
        empresaId: i < 4 ? "balao" : "outra",
        gerente: i === 0,
        createdAt: 1_000 + i,
      }));
      const antes = chamadas.length;
      const primeira = migrarRegistros(bots);
      assert.equal(primeira.criados.length, 23);
      const segunda = migrarRegistros(bots);
      assert.deepEqual(segunda.criados, []);
      assert.equal(segunda.jaExistiam.length, 23);
      const subidas = chamadas.slice(antes).filter((a) => a[0] === "run" || a[0] === "start");
      assert.deepEqual(subidas, []);
      assert.equal(fs.readFileSync(antigo, "utf8"), "login-que-fica");

      const portas = new Set<number>();
      const nomes = new Set<string>();
      for (const b of bots) {
        const r = lerRegistro(b.id)!;
        assert.ok(r, b.id);
        assert.equal(portas.has(r.portaTela), false, `porta repetida ${r.portaTela}`);
        assert.equal(nomes.has(r.container), false, r.container);
        portas.add(r.portaTela);
        nomes.add(r.container);
        assert.equal(r.portaTela === 8787 || r.portaTela === 8791, false);
        assert.equal(r.portaCdp === 8787 || r.portaCdp === 8791, false);
        assert.match(r.container, /^mybots-bot-/);
        assert.equal(fs.existsSync(path.join(dir, r.volume)), true);
        assert.equal(r.volume.startsWith("bots"), true);
      }
      assert.equal(botPadraoDaEmpresa("balao", bots), "bot-01");
      assert.equal(botPadraoDaEmpresa("outra", bots), "bot-05");
      assert.equal(classificarRotaPc("balao", true, false), "empresa");
      assert.equal(classificarRotaPc("bot-01", false, true), "bot");
      assert.equal(classificarRotaPc("balao", true, true), "empresa");
      assert.equal(classificarRotaPc("ninguem", false, false), "nenhum");

      const pol = politicaDoPc();
      assert.equal(pol.ociosoMin, 15);
      assert.equal(pol.memoria, "2560m");
      assert.equal(pol.cpus, "1");
      const minuto = 60_000;
      assert.equal(deveParar({ agora: 15 * minuto, ultimoUso: 0, espectadores: 0, ociosoMs: pol.ociosoMs, rodando: true }), true);
      assert.equal(deveParar({ agora: 14 * minuto, ultimoUso: 0, espectadores: 0, ociosoMs: pol.ociosoMs, rodando: true }), false);
      assert.equal(deveParar({ agora: 60 * minuto, ultimoUso: 0, espectadores: 1, ociosoMs: pol.ociosoMs, rodando: true }), false);
      assert.equal(deveParar({ agora: 60 * minuto, ultimoUso: 0, espectadores: 0, ociosoMs: pol.ociosoMs, rodando: false }), false);

      const bia = registrarPc({ botId: "bia", empresaId: "balao", nome: "Bia" });
      ligados.add(bia.container);
      criados.add(bia.container);
      const ociosoMs = pol.ociosoMs;
      assert.deepEqual(await varrerOciosos({ agora: 0, ocupado: () => false }), []);
      assert.equal(ligados.has(bia.container), true);
      assert.deepEqual(await varrerOciosos({ agora: ociosoMs, ocupado: () => false }), ["bia"]);
      assert.equal(ligados.has(bia.container), false);

      ligados.add(bia.container);
      abrirTela("bia", ociosoMs);
      assert.equal(espectadores("bia"), 1);
      assert.deepEqual(await varrerOciosos({ agora: ociosoMs * 3, ocupado: () => false }), []);
      fecharTela("bia", ociosoMs * 3);
      assert.equal(espectadores("bia"), 0);
      assert.deepEqual(await varrerOciosos({ agora: ociosoMs * 4, ocupado: () => true }), []);
      assert.deepEqual(await varrerOciosos({ agora: ociosoMs * 5, ocupado: () => false }), ["bia"]);

      zerarUsoParaTeste();
      const lia = registrarPc({ botId: "lia", empresaId: null, nome: "Lia" });
      const subiu = await acordarPc("lia", 10);
      assert.equal(subiu?.estado, "ligada", subiu?.erro);
      const run = chamadas.find((a) => a[0] === "run" && a.includes(lia.container));
      assert.ok(run, "faltou o docker run");
      assert.equal(run.includes("--pull=never"), true);
      assert.equal(run.includes("--restart"), true);
      assert.equal(run[run.indexOf("--restart") + 1], "no");
      assert.equal(run[run.indexOf("--memory") + 1], "2560m");
      assert.equal(run[run.indexOf("--cpus") + 1], "1");
      assert.equal(run.some((p) => p.startsWith("127.0.0.1:") && p.includes(":3000")), true);
      assert.equal(run.some((p) => p.includes("8787") || p.includes("8791")), false);
      assert.equal(run.includes(NAVEGADOR_DO_PC.imagem), true);
      assert.equal(run.includes("0.0.0.0:"), false);

      const subidasAntes = chamadas.filter((a) => a[0] === "run" || a[0] === "start").length;
      const lista = await listarMaquinas();
      assert.equal(chamadas.filter((a) => a[0] === "run" || a[0] === "start").length, subidasAntes);
      const pcLia = lista.find((x) => x.botId === "lia" && x.tipo === "pc");
      const andLia = lista.find((x) => x.botId === "lia" && x.tipo === "android");
      assert.equal(pcLia?.estado, "ligado");
      assert.equal(pcLia?.porta, lia.portaTela);
      assert.equal(pcLia?.ultimoUso, 10);
      assert.equal(pcLia?.acessoLiberado, true);
      assert.equal(pcLia?.empresaId, null);
      assert.equal(andLia?.estado, "sem-provedor");
      assert.equal(andLia?.porta, null);
      assert.equal(acessoAberto("lia"), true);
      assert.equal(definirAcessoPc("lia", false)?.acessoLiberado, false);
      assert.equal(acessoAberto("lia"), false);
      assert.equal((await listarMaquinas()).find((x) => x.botId === "lia" && x.tipo === "pc")?.acessoLiberado, false);
      migrarRegistros([{ id: "lia", nome: "Lia", empresaId: "balao" }]);
      assert.equal(acessoAberto("lia"), false);
      assert.equal(lerRegistro("lia")?.empresaId, "balao");
      definirAcessoPc("lia", true);

      assert.equal(await resolverAlvoAndroid("bia"), null);
      registrarProvedorAndroid({
        id: "redroid",
        prioridade: 1,
        resolver: async () => ({ tipo: "container", nome: "redroid-bia", host: "127.0.0.1", porta: 5555 }),
      });
      registrarProvedorAndroid({
        id: "porta-proibida",
        prioridade: 50,
        resolver: async () => ({ tipo: "aparelho", serial: "192.168.15.9:8787", host: "192.168.15.9", porta: 8787 }),
      });
      registrarProvedorAndroid({
        id: "quebrado",
        prioridade: 40,
        resolver: async () => { throw new Error("adb fora"); },
      });
      registrarProvedorAndroid({
        id: "aparelho",
        prioridade: 10,
        resolver: async () => ({ tipo: "aparelho", serial: "192.168.15.20:37123", host: "192.168.15.20", porta: 37123 }),
      });
      const alvo = await resolverAlvoAndroid("bia");
      assert.equal(alvo?.tipo, "aparelho");
      if (alvo?.tipo === "aparelho") assert.equal(alvo.serial, "192.168.15.20:37123");
      assert.equal(idDoAndroid("/android/bia/"), "bia");
      assert.equal(idDoAndroid("/android/bia/stream"), "bia");
      assert.equal(idDoAndroid("/android/../etc"), null);
      const dockerAntes = chamadas.length;
      await resolverAlvoAndroid("bia");
      assert.equal(chamadas.length, dockerAntes);
      const celBia = (await listarMaquinas()).find((x) => x.botId === "bia" && x.tipo === "android");
      assert.equal(celBia?.estado, "ligado");
      assert.equal(celBia?.porta, 37123);

      limparProvedoresAndroid();
      let resolveu = false;
      registrarProvedorAndroid({
        id: "wifi",
        prioridade: 10,
        relatar: async () => ({ estado: "desligado", porta: 5555, ultimoUso: 9 }),
        resolver: async () => { resolveu = true; return { tipo: "aparelho", serial: "192.168.15.20:5555", host: "192.168.15.20", porta: 5555 }; },
      });
      registrarProvedorAndroid({
        id: "redroid-baixo",
        prioridade: 1,
        relatar: async () => ({ estado: "ligado", porta: 8787 }),
        resolver: async () => null,
      });
      const relato = (await listarMaquinas()).find((x) => x.botId === "bia" && x.tipo === "android");
      assert.equal(relato?.estado, "desligado");
      assert.equal(relato?.porta, 5555);
      assert.equal(relato?.ultimoUso, 9);
      assert.equal(resolveu, false);
      limparProvedoresAndroid();
      registrarProvedorAndroid({
        id: "porta-ruim",
        prioridade: 1,
        relatar: async () => ({ estado: "erro", porta: 8791 }),
        resolver: async () => null,
      });
      const ruim = (await listarMaquinas()).find((x) => x.botId === "bia" && x.tipo === "android");
      assert.equal(ruim?.estado, "erro");
      assert.equal(ruim?.porta, null);
      limparProvedoresAndroid();

      const dbArq = path.join(dir, "hub.sqlite");
      const db = new Database(dbArq);
      db.exec(`CREATE TABLE bots (id TEXT PRIMARY KEY, name TEXT, role TEXT, created_at INTEGER, empresa_id TEXT, ponte INTEGER);
        CREATE TABLE managed_bots (id TEXT PRIMARY KEY, def TEXT NOT NULL, created_at INTEGER NOT NULL);`);
      db.prepare(`INSERT INTO bots (id, name, role, created_at, empresa_id, ponte) VALUES (?,?,?,?,?,?)`).run("joao", "João", "", 1, "balao", 0);
      db.prepare(`INSERT INTO managed_bots (id, def, created_at) VALUES (?,?,?)`).run("joao", JSON.stringify({ name: "João", gerente: false, createdAt: 5, provider: { apiKey: "nao-imprimir" } }), 5);
      db.close();
      const pastaBots = path.join(dir, "pasta-bots");
      fs.mkdirSync(path.join(pastaBots, "maria"), { recursive: true });
      fs.writeFileSync(path.join(pastaBots, "maria", "mybots-node.json"), JSON.stringify({ bot: { id: "maria", name: "Maria" } }));
      fs.mkdirSync(path.join(pastaBots, "sumiu"));
      fs.writeFileSync(path.join(pastaBots, "sumiu", "mybots-node.json"), JSON.stringify({ bot: { id: "sumiu", name: "Sumiu" } }));
      fs.writeFileSync(path.join(pastaBots, "sumiu", ".removido"), "1\n");
      const achados = [...botsDaPasta(pastaBots), ...botsDoBanco(dbArq)];
      assert.equal(achados.some((b) => b.id === "sumiu"), false);
      assert.equal(achados.find((b) => b.id === "joao")?.empresaId, "balao");

      const raiz2 = pasta();
      fs.mkdirSync(path.join(raiz2, "balao"), { recursive: true });
      fs.writeFileSync(path.join(raiz2, "balao", "perfil.txt"), "ainda-aqui");
      const n = chamadas.length;
      const resumo = executarMigracao({ db: dbArq, botsDir: pastaBots, raiz: raiz2 });
      assert.deepEqual(resumo.criados.sort(), ["joao", "maria"]);
      assert.deepEqual(resumo.volumesApagados, []);
      assert.equal(resumo.containersLigados, 0);
      assert.equal(fs.readFileSync(path.join(raiz2, "balao", "perfil.txt"), "utf8"), "ainda-aqui");
      assert.equal(chamadas.slice(n).some((a) => a[0] === "run" || a[0] === "start"), false);
      const outra = executarMigracao({ db: dbArq, botsDir: pastaBots, raiz: raiz2 });
      assert.deepEqual(outra.criados, []);
      assert.equal(lerRegistro("joao")?.portaTela, (JSON.parse(fs.readFileSync(path.join(raiz2, "pcs.json"), "utf8")).joao.portaTela));
    } finally {
      definirDocker(null);
      zerarUsoParaTeste();
      limparProvedoresAndroid();
      delete process.env.MYBOTS_MAQUINAS_DIR;
    }
  });

  test("um container por bot sobe e para por ociosidade", { timeout: 60_000 }, async (t) => {
    definirDocker(null);
    zerarUsoParaTeste();
    const info = await docker(["info", "--format", "{{.ServerVersion}}"], 15000);
    if (!info.ok) {
      t.skip("docker indisponível neste ambiente");
      return;
    }
    const dir = pasta();
    const anterior = {
      dir: process.env.MYBOTS_MAQUINAS_DIR,
      img: process.env.MYBOTS_PC_IMAGEM,
      cmd: process.env.MYBOTS_PC_COMANDO,
      min: process.env.MYBOTS_PC_OCIOSO_MIN,
      mem: process.env.MYBOTS_PC_MEMORIA,
      cpu: process.env.MYBOTS_PC_CPU,
      ponte: process.env.MYBOTS_PC_PONTE,
    };
    process.env.MYBOTS_MAQUINAS_DIR = dir;
    process.env.MYBOTS_PC_IMAGEM = "alpine:3.20";
    process.env.MYBOTS_PC_COMANDO = "sleep 120";
    process.env.MYBOTS_PC_OCIOSO_MIN = "0.05";
    process.env.MYBOTS_PC_MEMORIA = "128m";
    process.env.MYBOTS_PC_CPU = "0.5";
    process.env.MYBOTS_PC_PONTE = "0";
    zerarUsoParaTeste();
    const linhas: string[] = [];
    const log = (s: string) => { linhas.push(s); console.log(s); };
    let container = "";
    try {
      const reg = registrarPc({ botId: "demo", empresaId: "balao", nome: "Demo" });
      registrarPc({ botId: "vizinho", empresaId: "balao", nome: "Vizinho" });
      container = reg.container;
      assert.match(container, /^mybots-bot-demo/);
      log(`[demo] registro ${container} porta ${reg.portaTela} cdp ${reg.portaCdp} sem subir o vizinho`);
      const subiu = await acordarPc("demo");
      assert.equal(subiu?.estado, "ligada", subiu?.erro);
      const ps = await docker(["ps", "--filter", `name=${container}`, "--format", "{{.Names}} {{.Status}} {{.Image}}"]);
      log(`[demo] docker ps: ${ps.saida.trim()}`);
      const insp = await docker(["inspect", "-f", "{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.RestartPolicy.Name}} {{json .HostConfig.PortBindings}}", container]);
      log(`[demo] limites: ${insp.saida.trim()}`);
      assert.match(insp.saida, /^134217728 500000000 no /);
      assert.match(insp.saida, /127\.0\.0\.1/);
      assert.equal(insp.saida.includes("8787"), false);
      assert.equal(insp.saida.includes("8791"), false);
      const vizinho = await docker(["ps", "-a", "--filter", "name=mybots-bot-vizinho", "--format", "{{.Names}}"]);
      assert.equal(vizinho.saida.trim(), "");
      log("[demo] vizinho não foi criado");
      await new Promise((r) => setTimeout(r, 3500));
      const parados = await varrerOciosos();
      log(`[demo] varredura parou: ${parados.join(", ") || "(ninguém)"}`);
      assert.deepEqual(parados, ["demo"]);
      const depois = await docker(["ps", "-a", "--filter", `name=${container}`, "--format", "{{.Names}} {{.Status}}"]);
      log(`[demo] depois: ${depois.saida.trim()}`);
      assert.match(depois.saida, /Exited/);
      const arq = path.join(os.tmpdir(), "pc-ocioso-demo.log");
      fs.writeFileSync(arq, linhas.join("\n") + "\n");
      log(`[demo] log em ${arq}`);
    } finally {
      if (container) await docker(["rm", "-f", container], 20000);
      if (anterior.dir === undefined) delete process.env.MYBOTS_MAQUINAS_DIR; else process.env.MYBOTS_MAQUINAS_DIR = anterior.dir;
      if (anterior.img === undefined) delete process.env.MYBOTS_PC_IMAGEM; else process.env.MYBOTS_PC_IMAGEM = anterior.img;
      if (anterior.cmd === undefined) delete process.env.MYBOTS_PC_COMANDO; else process.env.MYBOTS_PC_COMANDO = anterior.cmd;
      if (anterior.min === undefined) delete process.env.MYBOTS_PC_OCIOSO_MIN; else process.env.MYBOTS_PC_OCIOSO_MIN = anterior.min;
      if (anterior.mem === undefined) delete process.env.MYBOTS_PC_MEMORIA; else process.env.MYBOTS_PC_MEMORIA = anterior.mem;
      if (anterior.cpu === undefined) delete process.env.MYBOTS_PC_CPU; else process.env.MYBOTS_PC_CPU = anterior.cpu;
      if (anterior.ponte === undefined) delete process.env.MYBOTS_PC_PONTE; else process.env.MYBOTS_PC_PONTE = anterior.ponte;
      zerarUsoParaTeste();
    }
  });

  test("aba Computadores: lista, liga, desliga e trava a tela", { timeout: 40_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mybots-api-pc-"));
    const senha = "senha-da-aba";
    const porta = 18794;
    const hubDir = path.resolve(import.meta.dirname, "../packages/hub");
    let log = "";
    const hub: ChildProcess = spawn(process.execPath, ["--import", "tsx", path.join(hubDir, "src/index.ts")], {
      cwd: hubDir,
      env: {
        ...process.env,
        MYBOTS_HUB_HOST: "127.0.0.1",
        MYBOTS_HUB_PORT: String(porta),
        MYBOTS_HUB_TOKEN: "token-teste-maquinas",
        MYBOTS_UI_PASSWORD: senha,
        MYBOTS_DB: path.join(dir, "hub.sqlite"),
        MYBOTS_BOTS_DIR: path.join(dir, "bots"),
        MYBOTS_UI_DIST: path.join(dir, "sem-ui"),
        MYBOTS_MAQUINAS_DIR: path.join(dir, "maquinas"),
        MYBOTS_PC_PONTE: "0",
        MYBOTS_PC_IMAGEM: "",
        TELEGRAM_BOT_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    hub.stdout?.on("data", (d) => { log += d.toString(); });
    hub.stderr?.on("data", (d) => { log += d.toString(); });
    const base = `http://127.0.0.1:${porta}`;
    const k = `k=${encodeURIComponent(senha)}`;
    const matar = () => { try { hub.kill("SIGTERM"); } catch { /* já saiu */ } };
    try {
      const fim = Date.now() + 20_000;
      let noAr = false;
      while (Date.now() < fim) {
        try {
          const r = await fetch(`${base}/api/health?${k}`);
          if (r.ok) { noAr = true; break; }
        } catch { /* ainda subindo */ }
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.equal(noAr, true, "o hub de teste não subiu\n" + log.replaceAll(senha, "***").slice(-800));

      const semSenha = await fetch(`${base}/api/maquinas`);
      assert.equal(semSenha.status, 401);

      const vazia = await (await fetch(`${base}/api/maquinas?${k}`)).json() as unknown[];
      assert.deepEqual(vazia, []);

      const emp = await fetch(`${base}/api/empresas?${k}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome: "Casa", comGerente: false }),
      });
      assert.equal(emp.status, 200, await emp.text());
      const criado = await fetch(`${base}/api/managed?${k}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bia Tela",
          empresa: "casa",
          engine: "direct",
          provider: { kind: "nous", model: "mock-1", apiKey: "k" },
        }),
      });
      const bot = await criado.json() as { id?: string; error?: string };
      assert.equal(criado.status, 200, JSON.stringify(bot));
      assert.equal(bot.id, "bia-tela");

      const lista = await (await fetch(`${base}/api/maquinas?${k}`)).json() as Array<{ botId: string; empresaId: string | null; tipo: string; estado: string; porta: number | null; ultimoUso: number | null; acessoLiberado: boolean }>;
      const pc = lista.find((x) => x.botId === "bia-tela" && x.tipo === "pc");
      const cel = lista.find((x) => x.botId === "bia-tela" && x.tipo === "android");
      assert.ok(pc, JSON.stringify(lista));
      assert.equal(pc.empresaId, "casa");
      assert.equal(pc.acessoLiberado, true);
      assert.equal(pc.estado === "ligado" || pc.estado === "desligado" || pc.estado === "erro", true);
      assert.equal(typeof pc.porta, "number");
      assert.equal(pc.porta === 8787 || pc.porta === 8791, false);
      assert.equal(cel?.estado, "sem-provedor");
      assert.equal(cel?.acessoLiberado, true);

      const trava = await fetch(`${base}/api/maquinas/bia-tela/acesso?${k}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liberado: false }),
      });
      assert.equal(trava.status, 200);
      const tela = await fetch(`${base}/pc/bia-tela/?${k}`);
      assert.equal(tela.status, 403);
      const pelaEmpresa = await fetch(`${base}/pc/casa/?${k}`);
      assert.equal(pelaEmpresa.status, 403);
      const ruim = await fetch(`${base}/api/maquinas/bia-tela/acesso?${k}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liberado: "sim" }),
      });
      assert.equal(ruim.status, 400);

      const abre = await fetch(`${base}/api/maquinas/bia-tela/acesso?${k}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liberado: true }),
      });
      assert.equal(abre.status, 200);
      const telaAberta = await fetch(`${base}/pc/bia-tela/?${k}`);
      assert.notEqual(telaAberta.status, 403);

      const desliga = await fetch(`${base}/api/maquinas/bia-tela/desligar?${k}`, { method: "POST" });
      assert.equal(desliga.status, 200);
      const linhaOff = await desliga.json() as { tipo: string; estado: string; acessoLiberado: boolean };
      assert.equal(linhaOff.tipo, "pc");
      assert.equal(linhaOff.acessoLiberado, true);
      assert.equal(linhaOff.estado === "desligado" || linhaOff.estado === "erro", true);

      const liga = await fetch(`${base}/api/maquinas/bia-tela/ligar?${k}`, { method: "POST" });
      assert.equal(liga.status, 200);
      const linhaOn = await liga.json() as { estado: string };
      assert.equal(["ligado", "desligado", "ligando", "erro"].includes(linhaOn.estado), true);

      const fantasma = await fetch(`${base}/api/maquinas/nao-existe/ligar?${k}`, { method: "POST" });
      assert.equal(fantasma.status, 404);
    } finally {
      matar();
    }
  });
});
