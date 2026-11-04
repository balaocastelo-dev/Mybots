import { chamarCorretor, type Operacao } from "./corretorDoFuturo.js";

type Rpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };

const FERRAMENTAS = [
  {
    name: "buscar_imoveis",
    description: "Busca imóveis no corretordofuturo.app (contrato provisório GET /v1/imoveis). Não invente anúncio: só devolva o que a API devolver.",
    inputSchema: { type: "object", properties: { q: { type: "string" }, bairro: { type: "string" }, tipo: { type: "string" }, precoMin: { type: "number" }, precoMax: { type: "number" }, pagina: { type: "number" } } },
  },
  {
    name: "ver_imovel",
    description: "Detalhe de um imóvel (GET /v1/imoveis/{id}).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "criar_lead",
    description: "Cria um lead. Só envia se confirmado for true — a pessoa já aprovou esta gravação.",
    inputSchema: { type: "object", properties: { nome: { type: "string" }, telefone: { type: "string" }, email: { type: "string" }, mensagem: { type: "string" }, imovelId: { type: "string" }, confirmado: { type: "boolean" } }, required: ["nome", "telefone", "confirmado"] },
  },
  {
    name: "agendar_visita",
    description: "Agenda uma visita. Só envia se confirmado for true.",
    inputSchema: { type: "object", properties: { imovelId: { type: "string" }, quando: { type: "string" }, nome: { type: "string" }, telefone: { type: "string" }, observacao: { type: "string" }, confirmado: { type: "boolean" } }, required: ["imovelId", "quando", "nome", "telefone", "confirmado"] },
  },
];

const NOME_PARA_OP: Record<string, Operacao> = {
  buscar_imoveis: "buscar",
  ver_imovel: "detalhe",
  criar_lead: "lead",
  agendar_visita: "visita",
};

export type DepsMcp = { baseUrl: string; token: string; fetchImpl?: typeof fetch };

export async function tratar(msg: Rpc, deps: DepsMcp): Promise<Rpc | null> {
  if (msg.id === undefined || msg.id === null) return null;
  if (msg.method === "initialize") {
    return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "corretor-do-futuro", version: "1.0.0" } } } as Rpc;
  }
  if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: FERRAMENTAS } } as Rpc;
  if (msg.method === "ping") return { jsonrpc: "2.0", id: msg.id, result: {} } as Rpc;
  if (msg.method === "tools/call") {
    const nome = msg.params?.name ?? "";
    const operacao = NOME_PARA_OP[nome];
    if (!operacao) return erro(msg.id, `Ferramenta desconhecida: ${nome}`);
    const args = msg.params?.arguments ?? {};
    const r = await chamarCorretor({
      baseUrl: deps.baseUrl, token: deps.token, operacao, entrada: args,
      confirmado: args.confirmado === true, fetchImpl: deps.fetchImpl,
    });
    const texto = r.ok ? JSON.stringify(r.dados) : r.erro;
    return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: texto }], isError: !r.ok } } as Rpc;
  }
  return erro(msg.id, "Método não suportado");
}

function erro(id: number | string, message: string): Rpc {
  return { jsonrpc: "2.0", id, error: { code: -32601, message } } as Rpc;
}

export function enquadrar(obj: unknown): Buffer {
  const json = JSON.stringify(obj);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`, "utf8");
}

const ehMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
  || process.argv[1]?.endsWith("stdio.ts");

if (ehMain && process.argv[1] && (process.argv[1].endsWith("stdio.ts") || process.argv[1].endsWith("stdio.js"))) {
  let buf = Buffer.alloc(0);
  const deps = { baseUrl: process.env.CORRETOR_BASE_URL ?? "", token: process.env.CORRETOR_TOKEN ?? "" };
  const escrever = (msg: unknown) => { process.stdout.write(enquadrar(msg)); };
  const consumir = async () => {
    for (;;) {
      const headerFim = buf.indexOf("\r\n\r\n");
      const texto = buf.toString("utf8");
      if (/^content-length:/i.test(texto)) {
        if (headerFim < 0) return;
        const header = buf.subarray(0, headerFim).toString("utf8");
        const m = header.match(/Content-Length:\s*(\d+)/i);
        if (!m) return;
        const inicio = headerFim + 4;
        const len = Number(m[1]);
        if (buf.length < inicio + len) return;
        const corpo = buf.subarray(inicio, inicio + len).toString("utf8");
        buf = buf.subarray(inicio + len);
        const resp = await tratar(JSON.parse(corpo), deps);
        if (resp) escrever(resp);
        continue;
      }
      const nl = buf.indexOf(0x0a);
      if (nl < 0) return;
      const linha = buf.subarray(0, nl).toString("utf8").trim();
      buf = buf.subarray(nl + 1);
      if (!linha) continue;
      const resp = await tratar(JSON.parse(linha), deps);
      if (resp) escrever(resp);
    }
  };
  process.stdin.on("data", (chunk: Buffer) => { buf = Buffer.concat([buf, chunk]); void consumir(); });
}
