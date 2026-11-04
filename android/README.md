# MyBots no celular

Casca Android do painel. O aplicativo abre `https://www.balao.info/mybots` em tela cheia, guarda o login e não sobe servidor nenhum. O Hub, o nó e as portas da loja ficam como estão.

Pacote: `info.balao.mybots`. Android 7 ou mais novo (API 24).

Isto não é o celular de cada bot (pareamento adb e tela ao vivo). Aquilo continua em [docs/ANDROID.md](../docs/ANDROID.md).

## Instalar o APK no celular

1. Baixe o arquivo `app-debug.apk`. No GitHub, abra o pull request, entre na verificação **APK Android** e baixe o artifact **MyBots-debug**. Também dá para gerar o arquivo neste computador, como está mais abaixo.
2. Mande o APK para o celular: cabo USB, Drive ou uma conversa com você mesmo.
3. No celular, abra o arquivo. Se o Android barrar, permita a instalação para o aplicativo que recebeu o arquivo (Arquivos, Chrome ou WhatsApp):
   - Configurações → Apps → Acesso especial (ou Segurança) → **Instalar apps desconhecidos**
   - Ligue a permissão só para esse aplicativo
4. Toque em **Instalar** e abra **MyBots**.
5. Entre na conta uma vez. O cookie da sessão fica no aparelho: fechar o app e abrir de novo não pede login outra vez. O login some se você limpar os dados do MyBots ou desinstalar.

Para atualizar, instale o APK novo por cima. Não precisa desinstalar, e a sessão permanece enquanto o pacote for o mesmo (`info.balao.mybots`).

## No dia a dia

- A página ocupa a tela, abaixo de uma faixa com o nome e o ícone de **recarregar**. Dá para puxar a faixa de cima da página para atualizar. O puxão no meio da conversa continua rolando as mensagens.
- O botão **Voltar** do Android desce o histórico da página. No começo do histórico, ele sai do app.
- Sem internet, aparece **Sem conexão** com o botão **Tentar novamente**.
- Anexar um arquivo abre o seletor do Android.
- Download cai na pasta **Downloads** e avisa na barra de notificações. No Android 13 ou mais novo, o sistema pode pedir permissão de notificação na primeira vez.
- Link de outro site (mapa, WhatsApp, documento externo) abre no navegador. O que for `balao.info` continua aqui.

## Gerar o APK neste computador

Precisa do JDK 17 e do Android SDK (plataforma 35 e build-tools 35). No Android Studio, abra a pasta `android/` e use **Build → Build APK(s)**.

Na linha de comando, com `ANDROID_HOME` apontando para o SDK:

```powershell
cd android
.\gradlew.bat assembleDebug
```

O arquivo sai em `android\app\build\outputs\apk\debug\app-debug.apk`.

No Linux ou no macOS o comando é `./gradlew assembleDebug`. O GitHub Actions faz esse build e publica o APK como artifact a cada pull request que mexe nesta pasta.
