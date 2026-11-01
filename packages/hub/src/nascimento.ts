// Nascimento do bot: saudação e as duas ligações iniciais, uma de cada vez.
//
// O Hub fala pelo bot no chat (não espera o modelo). Gmail só vira "ok" quando
// a caixa de entrada está aberta na tela do PC. WhatsApp só vira "ok" quando a
// sessão do QR conecta. Senha não entra no estado, no chat nem no log.
//
// O resto (Telegram, banco, rede) não é pedido aqui. pedir() existe para a
// hora em que o bot for usar a ferramenta.

import { gmailConfirmado } from "./gmailTela.js";

export type PassoNascimento = "gmail" | "whatsapp" | "pronto";
export type MarcaGmail = "pendente" | "aberto" | "ok";

export type PedidoConexao = { ferramenta: string; motivo: string; em: number };

export type EstadoNascimento = {
  botId: string;
  nome: string;
  funcao: string;
  passo: PassoNascimento;
  gmail: MarcaGmail;
  /** Já avisou no chat que o login ainda não abriu, para o relógio não repetir. */
  gmailAviso: "nenhum" | "fechado" | "aberto";
  whatsapp: "pendente" | "ok";
  numero?: string;
  pedidos: PedidoConexao[];
  criadoEm: number;
  gmailTentativaEm?: number;
};

export type DepsNascimento = {
  falar(botId: string, texto: string): void;
  ler(botId: string): EstadoNascimento | undefined;
  gravar(e: EstadoNascimento): void;
  listar(): EstadoNascimento[];
  abrirGmail(botId: string): Promise<{ ok: boolean; motivo: string }>;
  urls(botId: string): Promise<string[]>;
  conectarWhats(botId: string): Promise<void>;
  whatsConectado(botId: string): boolean;
  numeroWhats(botId: string): string | undefined;
  agora(): number;
};

const ESPERA_GMAIL_MS = 20_000;
const ESPERA_PEDIDO_MS = 10 * 60_000;

export function textoSaudacao(nome: string, funcao: string): string {
  const papel = funcao.trim() ? ` Sou ${nome}, ${funcao}.` : ` Sou ${nome}.`;
  return `Olá. Obrigado por me criar.${papel} Para eu começar, preciso de duas ligações, uma de cada vez. Eu só marco cada uma como feita depois de conferir de verdade.`;
}

export function textoPedirGmail(abriu: boolean): string {
  const tela = abriu
    ? "Abri o login do Gmail na minha tela do PC."
    : "O login do Gmail abre na minha tela do PC assim que ela estiver no ar. Se não aparecer, use Abrir login do Gmail no painel.";
  return `1. Gmail. ${tela} Entre com o e-mail e a senha você mesmo, nessa tela. Eu não vejo a senha, não guardo e não escrevo ela no chat. Quando a caixa de entrada abrir, eu confirmo aqui.`;
}

export function textoGmailOk(): string {
  return "Gmail confirmado: a caixa de entrada abriu na minha tela. Não guardei senha nenhuma.";
}

export function textoPedirWhats(): string {
  return "2. WhatsApp. O QR está no meu Celular. No seu telefone: WhatsApp, Aparelhos conectados, Conectar aparelho, e escaneie. Se o Celular não der, o mesmo QR aparece na tela do PC. Eu marco como feito só quando a sessão conectar.";
}

export function textoPronto(numero?: string): string {
  const n = numero ? ` no número ${numero}` : "";
  return `WhatsApp conectado${n}. A sessão fica na minha pasta, então eu não deslogo quando o painel reinicia. O celular principal precisa entrar na internet de vez em quando (cerca de 14 dias), senão o WhatsApp desliga o aparelho conectado. As outras ferramentas eu peço só na hora em que precisar delas.`;
}

export function textoPedido(ferramenta: string, motivo: string): string {
  return `Preciso de ${ferramenta} agora: ${motivo} Quando puder, conecte. Eu não marco como feito sem conferir.`;
}

/** Tira senha colada no texto. O que sobra pode ir para o chat. */
export function semSenha(texto: string): string {
  let s = String(texto ?? "");
  s = s.replace(/(senha|password|passwd)\s*[:=]\s*\S+/gi, "$1: ••••");
  s = s.replace(/\b([\w.+-]{1,80}@[\w.-]+\.[a-z]{2,})\s+([^\s]{6,64})\b/gi, (tudo, email, resto) => {
    if (/^[A-Za-z0-9!@#$%^&*._+-]+$/.test(resto) && !/[.]{2,}/.test(resto)) return `${email} ••••`;
    return tudo;
  });
  return s;
}

export function motivoLimpo(bruto: string): string {
  return semSenha(String(bruto ?? "").replace(/\s+/g, " ").trim()).slice(0, 240);
}

function vazio(b: { id: string; nome: string; funcao?: string }, agora: number): EstadoNascimento {
  return {
    botId: b.id,
    nome: b.nome,
    funcao: (b.funcao ?? "").trim(),
    passo: "gmail",
    gmail: "pendente",
    gmailAviso: "nenhum",
    whatsapp: "pendente",
    pedidos: [],
    criadoEm: agora,
  };
}

export class Nascimento {
  constructor(private deps: DepsNascimento) {}

  async nascer(b: { id: string; nome: string; funcao?: string }): Promise<EstadoNascimento> {
    const ja = this.deps.ler(b.id);
    if (ja) return ja;
    const e = vazio(b, this.deps.agora());
    this.deps.gravar(e);
    this.deps.falar(b.id, textoSaudacao(e.nome, e.funcao));
    await this.tentarGmail(b.id, true);
    return this.deps.ler(b.id) ?? e;
  }

  /** Abre o login de novo. Fala no chat só na primeira vez de cada situação. */
  async tentarGmail(botId: string, forcar = false): Promise<EstadoNascimento | undefined> {
    const e = this.deps.ler(botId);
    if (!e || e.gmail === "ok") return e;
    const agora = this.deps.agora();
    if (!forcar && e.gmailTentativaEm && agora - e.gmailTentativaEm < ESPERA_GMAIL_MS) return e;
    e.gmailTentativaEm = agora;
    this.deps.gravar(e);
    const r = await this.deps.abrirGmail(botId);
    const atual = this.deps.ler(botId);
    if (!atual || atual.gmail === "ok") return atual;
    if (r.ok) {
      atual.gmail = "aberto";
      if (atual.gmailAviso !== "aberto") {
        atual.gmailAviso = "aberto";
        this.deps.gravar(atual);
        this.deps.falar(botId, textoPedirGmail(true));
      } else this.deps.gravar(atual);
      return this.deps.ler(botId);
    }
    if (atual.gmailAviso === "nenhum") {
      atual.gmailAviso = "fechado";
      this.deps.gravar(atual);
      this.deps.falar(botId, textoPedirGmail(false));
    }
    return this.deps.ler(botId);
  }

  /**
   * Olha os endereços das abas. Só a caixa (mail.google.com/mail) marca feito.
   * O endereço em si não é gravado.
   */
  async conferirGmail(botId: string): Promise<EstadoNascimento | undefined> {
    const e = this.deps.ler(botId);
    if (!e || e.gmail === "ok") return e;
    let urls: string[] = [];
    try { urls = await this.deps.urls(botId); } catch { urls = []; }
    if (!urls.some((u) => gmailConfirmado(u))) return e;
    e.gmail = "ok";
    e.passo = "whatsapp";
    this.deps.gravar(e);
    this.deps.falar(botId, textoGmailOk());
    await this.seguirWhats(botId);
    return this.deps.ler(botId);
  }

  private async seguirWhats(botId: string) {
    const e = this.deps.ler(botId);
    if (!e || e.gmail !== "ok" || e.whatsapp === "ok") return;
    if (this.deps.whatsConectado(botId)) {
      this.aoWhats({ botId, estado: "conectado", numero: this.deps.numeroWhats(botId) });
      return;
    }
    this.deps.falar(botId, textoPedirWhats());
    await this.deps.conectarWhats(botId).catch(() => {});
  }

  /** QR sozinho não conta. Só a sessão aberta, e só depois do Gmail. */
  aoWhats(estado: { botId: string; estado: string; numero?: string }) {
    if (estado.estado !== "conectado") return;
    const e = this.deps.ler(estado.botId);
    if (!e || e.whatsapp === "ok" || e.gmail !== "ok") return;
    e.whatsapp = "ok";
    e.passo = "pronto";
    if (estado.numero) e.numero = estado.numero;
    this.deps.gravar(e);
    this.deps.falar(e.botId, textoPronto(e.numero));
  }

  async tick() {
    for (const e of this.deps.listar()) {
      if (e.gmail === "ok") continue;
      if (e.gmail === "aberto") await this.conferirGmail(e.botId);
      else if (e.passo === "gmail") await this.tentarGmail(e.botId);
    }
  }

  async retomar() {
    for (const e of this.deps.listar()) {
      if (e.passo === "gmail" && e.gmail !== "ok") await this.tentarGmail(e.botId, true);
      else if (e.passo === "whatsapp" && e.whatsapp !== "ok") await this.deps.conectarWhats(e.botId).catch(() => {});
    }
  }

  /**
   * Ligação pedida na hora do uso. Não marca feito.
   * Gmail e WhatsApp reabrem o passo que já existe, em vez de virar um pedido solto.
   */
  async pedir(botId: string, ferramenta: string, motivo: string): Promise<{ ok: boolean; texto: string }> {
    const nome = String(ferramenta ?? "").trim().toLowerCase();
    const m = motivoLimpo(motivo);
    if (!nome || !m) return { ok: false, texto: "Diga a ferramenta e o motivo, sem a senha." };
    if (m.includes("••••") && /senha|password/i.test(String(motivo ?? ""))) {
      return { ok: false, texto: "Não mando senha no chat. O chefe digita na tela do PC." };
    }
    if (nome === "gmail" || nome === "email" || nome === "e-mail") {
      const atual = this.deps.ler(botId);
      if (atual?.gmail === "ok") return { ok: true, texto: "O Gmail deste bot já foi confirmado." };
      await this.garantir(botId);
      await this.tentarGmail(botId, true);
      return { ok: true, texto: "O login do Gmail está na tela do PC. Não peça a senha no chat. Só fica feito quando a caixa abrir." };
    }
    if (nome === "whatsapp") {
      const e = this.deps.ler(botId);
      if (e && e.gmail !== "ok" && e.passo === "gmail") {
        return { ok: false, texto: "O Gmail ainda não foi confirmado. Ele vem primeiro." };
      }
      if (this.deps.whatsConectado(botId)) return { ok: true, texto: "O WhatsApp deste bot já está conectado." };
      await this.deps.conectarWhats(botId).catch(() => {});
      return { ok: true, texto: "O QR do WhatsApp está no Celular deste bot. Só fica feito quando conectar." };
    }
    const e = this.deps.ler(botId) ?? this.garantir(botId);
    const recente = e.pedidos.find((p) => p.ferramenta === nome && this.deps.agora() - p.em < ESPERA_PEDIDO_MS);
    if (recente) return { ok: true, texto: "Esse pedido já está no chat. Ainda não está feito." };
    e.pedidos = [...e.pedidos, { ferramenta: nome, motivo: m, em: this.deps.agora() }];
    this.deps.gravar(e);
    this.deps.falar(botId, textoPedido(nome, m));
    return { ok: true, texto: "Pedido no chat. Não está feito: o chefe conecta, e eu não marco sem conferir." };
  }

  private garantir(botId: string): EstadoNascimento {
    const ja = this.deps.ler(botId);
    if (ja) return ja;
    const e = vazio({ id: botId, nome: botId }, this.deps.agora());
    e.passo = "pronto";
    this.deps.gravar(e);
    return e;
  }
}
