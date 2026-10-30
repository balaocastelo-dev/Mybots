// Leis e consentimentos.
//
// Isto é MODELO, não parecer jurídico: um advogado tem de ler antes de a empresa
// falar com cliente de verdade. O que o sistema garante é o resto — que o aceite
// fica registrado com data e versão, e que o WhatsApp da empresa não envia nada
// enquanto os consentimentos obrigatórios não estiverem aceitos.
export const VERSAO_LEGAL = "2026-10-30.1";

export type DocLegal = {
  id: string;
  titulo: string;
  obrigatorio: boolean;
  resumo: string;
  /** o que o chefe está declarando ao aceitar */
  declaracao: string;
  corpo: string[];
};

export const DOCS_LEGAIS: DocLegal[] = [
  {
    id: "lgpd-controlador",
    titulo: "LGPD — quem é o controlador dos dados",
    obrigatorio: true,
    resumo: "A empresa é a controladora. O MyBots é a ferramenta que trata os dados por ordem dela.",
    declaracao: "Declaro que esta empresa é a controladora dos dados pessoais tratados aqui e que responde por eles.",
    corpo: [
      "Lei nº 13.709/2018 (LGPD).",
      "CONTROLADOR: a empresa cadastrada. É ela quem decide por que e como os dados dos clientes são tratados, e é dela a responsabilidade perante o titular e a ANPD.",
      "OPERADOR: o MyBots, instalado no computador da empresa, trata os dados seguindo as ordens do controlador. Não usa os dados dos clientes para nenhuma finalidade própria.",
      "DADOS TRATADOS: nome, telefone, e-mail, histórico de conversa, pedidos e o que o cliente enviar espontaneamente (fotos, documentos, áudios).",
      "FINALIDADE: atendimento, orçamento, venda, suporte e cobrança dos próprios clientes da empresa.",
      "BASE LEGAL: execução de contrato ou procedimentos preliminares (art. 7º, V) para quem já é cliente ou pediu atendimento; legítimo interesse (art. 7º, IX) para atendimento de quem procurou a empresa; consentimento (art. 7º, I) para envio de oferta não solicitada.",
      "ONDE FICAM: no banco do MyBots, no computador da empresa. Não há cópia em nuvem feita pelo sistema, além das que a própria empresa configurar.",
      "ENCARREGADO (DPO): a empresa deve indicar um nome e um canal público de contato do titular. Sem isso, a empresa está em falta com o art. 41.",
    ],
  },
  {
    id: "ia-identificada",
    titulo: "O cliente precisa saber que fala com um robô",
    obrigatorio: true,
    resumo: "Toda mensagem que sai para cliente é identificada como equipe de IA.",
    declaracao: "Concordo que as mensagens enviadas pelos bots se identifiquem como atendimento por IA.",
    corpo: [
      "Mensagem automatizada que se faz passar por pessoa é prática enganosa (CDC, arts. 6º, III e 37) e mina a confiança do cliente.",
      "Os bots assinam como equipe de IA da empresa, e dizem que são robô quando perguntados.",
      "Quando o cliente pedir para falar com uma pessoa, o bot passa para um humano em vez de insistir.",
      "Nenhum bot promete preço, prazo ou condição que não esteja no catálogo ou nas regras da empresa.",
    ],
  },
  {
    id: "whatsapp-contato",
    titulo: "WhatsApp — só fala com quem pode ser falado",
    obrigatorio: true,
    resumo: "Nada de disparo em massa para quem não pediu contato.",
    declaracao: "Declaro que os números que esta empresa contata pediram atendimento ou são clientes dela, e que o envio em massa não autorizado não será usado.",
    corpo: [
      "O número conectado pertence à empresa e é usado conforme os Termos do WhatsApp Business.",
      "O sistema fala com quem iniciou contato, é cliente, ou consentiu em receber mensagem.",
      "Lista comprada, raspagem de número e disparo em massa não autorizado ficam fora: além de violar a LGPD, derrubam o número.",
      "Todo pedido de descadastro (\"não quero mais receber\") é atendido na hora e anotado.",
      "Enviar mensagem sempre pede o OK do chefe, em qualquer modo de controle.",
    ],
  },
  {
    id: "voz-clonada",
    titulo: "Voz clonada — consentimento de quem emprestou a voz",
    obrigatorio: false,
    resumo: "Só use voz de uma pessoa real com autorização escrita dela.",
    declaracao: "Declaro ter autorização escrita de cada pessoa cuja voz é usada pelos bots desta empresa.",
    corpo: [
      "A voz é dado biométrico e atributo da personalidade (Código Civil, arts. 11 a 20; LGPD, art. 5º, II).",
      "Usar a voz de alguém sem autorização expressa é risco jurídico real, não formalidade — inclusive a voz de sócio ou funcionário.",
      "A autorização deve dizer: para que a voz será usada, por quanto tempo, e como a pessoa revoga.",
      "Revogada a autorização, a voz sai do sistema e os áudios já gerados com ela param de ser usados.",
      "Aceite este item só se os bots desta empresa forem usar voz de pessoa real.",
    ],
  },
  {
    id: "retencao-direitos",
    titulo: "Guarda dos dados e direitos do titular",
    obrigatorio: true,
    resumo: "Por quanto tempo fica, e como o cliente pede cópia ou exclusão.",
    declaracao: "Comprometo-me a atender pedidos de acesso, correção e exclusão dos clientes desta empresa.",
    corpo: [
      "O titular pode pedir confirmação, acesso, correção, portabilidade, anonimização e eliminação (LGPD, art. 18), e a resposta é devida em prazo razoável.",
      "Conversa de atendimento: guardada enquanto for útil ao relacionamento; depois, apagada ou anonimizada.",
      "Dado fiscal e de venda segue o prazo da lei fiscal, mesmo que o cliente peça exclusão — e isso deve ser explicado a ele.",
      "A exclusão feita pelo painel é definitiva no banco do MyBots; backups antigos seguem o ciclo deles.",
      "Vazamento ou incidente de segurança relevante: comunicar ANPD e titulares (art. 48).",
    ],
  },
  {
    id: "terceiros",
    titulo: "Para onde os dados vão quando o bot pensa",
    obrigatorio: true,
    resumo: "Modelos de IA e serviços usados, e o que é enviado a cada um.",
    declaracao: "Estou ciente de que o conteúdo das conversas é enviado ao provedor de modelo escolhido para gerar a resposta.",
    corpo: [
      "Para responder, o texto da conversa vai ao provedor do modelo configurado no bot (por exemplo Anthropic ou Google), que pode estar fora do Brasil — transferência internacional (LGPD, arts. 33 a 36).",
      "O WhatsApp é operado pela Meta e tem os termos dele.",
      "Modelo rodando local (Ollama, Whisper, ComfyUI) não manda nada para fora: o dado fica na máquina.",
      "Quanto mais sensível o assunto, mais vale usar modelo local — a escolha é por bot.",
      "Dado de cartão, senha e documento não entram no sistema: o navegador dos bots recusa preencher, e nenhum bot pede esses dados ao cliente.",
    ],
  },
];

export const OBRIGATORIOS = DOCS_LEGAIS.filter((d) => d.obrigatorio).map((d) => d.id);
