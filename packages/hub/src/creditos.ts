// Créditos, plano e Pix.
//
// O cliente compra MENSALIDADE + CRÉDITOS: a assinatura cobre a plataforma e uma
// franquia de mensagens; acima dela, cada resposta de bot debita o saldo pelo preço
// combinado. O custo real (tokens) é medido ao lado, para o dono ver a margem — mas
// não é o que o cliente paga, porque ninguém entende token.
export type PrecoModelo = { entrada: number; saida: number; cacheLido: number; cacheGravado: number };

/** US$ por milhão de tokens. Tabela de CUSTO, não de venda. */
export const PRECOS: Record<string, PrecoModelo> = {
  "claude-haiku-4-5":   { entrada: 1,    saida: 5,  cacheLido: 0.1,  cacheGravado: 1.25 },
  "claude-sonnet-4-5":  { entrada: 3,    saida: 15, cacheLido: 0.3,  cacheGravado: 3.75 },
  "claude-opus-4-1":    { entrada: 15,   saida: 75, cacheLido: 1.5,  cacheGravado: 18.75 },
  "gemini-2.5-flash":   { entrada: 0.3,  saida: 2.5, cacheLido: 0.03, cacheGravado: 0.3 },
  "gemini-2.5-pro":     { entrada: 1.25, saida: 10,  cacheLido: 0.13, cacheGravado: 1.25 },
  local:                { entrada: 0,    saida: 0,  cacheLido: 0,    cacheGravado: 0 },
};

export const DOLAR = Number(process.env.MYBOTS_DOLAR ?? 5.4);

/** Custo em MILÉSIMOS de centavo — inteiro, para não acumular erro de arredondamento. */
export function custoMilesimos(modelo: string, u: { entrada?: number; saida?: number; cacheLido?: number; cacheGravado?: number }): number {
  const p = PRECOS[modelo] ?? (/ollama|lmstudio|local|qwen|llama/i.test(modelo) ? PRECOS.local : PRECOS["claude-haiku-4-5"]);
  const dolares =
    ((u.entrada ?? 0) * p.entrada + (u.saida ?? 0) * p.saida +
     (u.cacheLido ?? 0) * p.cacheLido + (u.cacheGravado ?? 0) * p.cacheGravado) / 1_000_000;
  return Math.round(dolares * DOLAR * 100 * 1000);
}

export const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------- Pix copia-e-cola (BR Code estático, padrão EMV do Banco Central) ----------
function campo(id: string, valor: string) { return id + String(valor.length).padStart(2, "0") + valor; }
function crc16(s: string) {
  let crc = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "").trim();

/**
 * Monta o "copia e cola" do Pix. Chave, nome e cidade são do RECEBEDOR (você).
 * txid liga o pagamento à recarga: é por ele que se confere quem pagou o quê.
 */
export function pixCopiaECola(o: { chave: string; nome: string; cidade: string; valorCentavos: number; txid: string }): string {
  const nome = semAcento(o.nome).slice(0, 25) || "RECEBEDOR";
  const cidade = semAcento(o.cidade).slice(0, 15) || "CAMPINAS";
  const txid = semAcento(o.txid).replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const mai = campo("00", "br.gov.bcb.pix") + campo("01", semAcento(o.chave));
  const corpo =
    campo("00", "01") +
    campo("26", mai) +
    campo("52", "0000") +
    campo("53", "986") +
    (o.valorCentavos > 0 ? campo("54", (o.valorCentavos / 100).toFixed(2)) : "") +
    campo("58", "BR") +
    campo("59", nome) +
    campo("60", cidade) +
    campo("62", campo("05", txid));
  const semCrc = corpo + "6304";
  return semCrc + crc16(semCrc);
}
