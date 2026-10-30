# Os canais de uma empresa nova — ordem, custo real e o que fica no contrato

A empresa nasce conectada: é isso que nenhum concorrente de graça entrega, porque
nenhum deles instala nada na casa de ninguém. Mas as seis conexões NÃO se ligam no
mesmo dia. Cada uma é opcional, tem um teste de ida e volta, e a empresa já trabalha
com uma só. O Gerente sugere a próxima quando um bot esbarra na falta dela — que é
quando o dono entende para que serve.

Na tela: seis cartões, cada um com ligado/desligado, "testar" e "revogar".

## 1. WhatsApp — primeiro, sempre
Paga-se no primeiro dia. QR no painel, teste mandando uma mensagem ao número do
próprio dono e esperando a resposta voltar.

**O aviso que vai no contrato, não só na cabeça de quem instala:** a conexão por QR usa
biblioteca não oficial, e a Meta bloqueia número que julga automatizado. No número do
cliente, isso é o telefone da empresa dele parando. Ou a empresa assume esse risco por
escrito, ou contrata a API oficial (paga, com verificação do Business). As duas são
defensáveis; o que não vale é o cliente descobrir depois.

## 2. Google — identidade na entrada, permissão sob demanda
Entrar com o Google é um clique e dá um e-mail verificado para ancorar a assinatura.
Ler Gmail, Drive ou Agenda são permissões separadas — categoria sensível/restrita, que
exige verificação do aplicativo, política publicada e, nas restritas, avaliação de
segurança de semanas. Pedir tudo na primeira tela é onde o cliente desiste.

Então: identidade na abertura; cada escopo depois, um por vez, com o motivo na tela
("o Gerente quer ler sua caixa de entrada para organizar os pedidos").

Técnico, decide se nasce certo: o Hub roda na máquina do cliente, então o fluxo é o de
aplicativo instalado — retorno em 127.0.0.1 e **PKCE, sem segredo embutido**. Segredo
dentro de instalador é segredo público.

## 3. Instagram e Facebook — trabalho da nossa empresa, uma vez
Publicar no Instagram exige conta Business ligada a uma Página, aplicativo aprovado pela
Meta e verificação do negócio. São semanas de análise, não um botão. É etapa nossa, feita
uma vez; para o cliente tem de ser só "conectar". Publicar começa em ensaio.

## 4. Mercado Pago (cobrança) e Mercado Livre (marketplace) — são duas coisas
- **Mercado Pago** é quem gera cobrança: Pix, boleto, cartão, link de pagamento. É o que
  a PME brasileira já usa.
- **Mercado Livre** é anúncio, pedido e pergunta de comprador. Para varejo de informática
  vale ouro (bot respondendo pergunta de anúncio às 23h), mas é outra integração, com
  outro propósito. Não confundir as duas por causa do sobrenome.

## 5. Guardar os dados — e por que NÃO no GitHub
Git foi feito para texto que muda devagar e que se lê num diff. Dado operacional é o
oposto: muda o tempo todo, é grande, metade é binário, e tem nome e telefone de cliente
dentro. Três problemas concretos:
1. Dado pessoal em repositório é exposição: vazou o token, vazou tudo — e sob a LGPD quem
   responde é a empresa do cliente, com a gente junto.
2. **Git não esquece.** Apagar um dado pessoal hoje não o tira do histórico, e o direito
   de eliminação vira reescrita de histórico.
3. Não há permissão por registro: ou a pessoa vê o repositório inteiro, ou não vê nada.

"Guardar, salvar e organizar" são duas coisas diferentes, com respostas diferentes:
- **Backup do banco** → o SQLite indo sozinho para um balde de objetos (R2, Backblaze,
  S3). Com Litestream é contínuo, barato, e restaurar é um comando. É o que salva o
  cliente quando o HD morre — hoje a maior fragilidade do sistema.
- **Configuração versionada** → personas, regras da casa, skills, prompts. Aí o Git é
  perfeito: é texto, muda devagar, e "quem mudou a regra do bot e quando" é exatamente o
  que se vai querer no dia em que um bot responder errado a um cliente.

Vira argumento de venda: *os seus dados ficam na sua máquina e no seu backup; só as
regras ficam versionadas.*

## Regra que vale para as seis
Só acende "ligado" depois de um teste que volta. Configurado não é funcionando — e quem
descobre a diferença não pode ser o cliente, na frente do cliente dele.
