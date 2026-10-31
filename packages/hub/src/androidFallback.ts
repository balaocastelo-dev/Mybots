/**
 * Redroid e emulador são o plano B. O plano A é o aparelho na mesma rede.
 *
 * Redroid precisa de binder (e, em kernel antigo, ashmem) dentro do kernel
 * que o Docker usa. O kernel padrão do WSL2, que é o do Docker Desktop no
 * Windows, vem sem CONFIG_ANDROID_BINDER_IPC. Sem isso o container abre e
 * morre. Trocar o kernel do WSL na loja não é o caminho.
 *
 * O emulador precisa de /dev/kvm. No Docker Desktop do Windows esse dispositivo
 * não chega no container. Sem KVM ele não serve para o dia a dia.
 *
 * Por isso os dois só sobem com MYBOTS_ANDROID_FALLBACK=redroid ou emulador,
 * e só quando a checagem abaixo diz que o host aguenta. O padrão é desligado.
 */
import fs from "node:fs";
import { execFile } from "node:child_process";

export const IMAGEM_REDROID = "redroid/redroid:12.0.0-latest";
export const IMAGEM_EMULADOR = "budtmo/docker-android:emulator_11.0";

export type FatosDoHost = {
  plataforma: string;
  wsl: boolean;
  docker: boolean;
  binder: boolean;
  ashmem: boolean;
  kvm: boolean;
};

export type Viabilidade = {
  redroid: { serve: boolean; motivo: string };
  emulador: { serve: boolean; motivo: string };
};

const MOTIVO_WINDOWS =
  "No Windows com Docker Desktop o Hub não enxerga binder nem KVM: os dois ficam dentro do WSL2. " +
  "O kernel padrão do WSL2 não tem o módulo binder, então o redroid não fica de pé. " +
  "O emulador pede /dev/kvm, que o Docker Desktop não entrega ao container. " +
  "O celular de verdade, na mesma Wi-Fi, não depende de nenhum dos dois.";

export function avaliarFallback(f: FatosDoHost): Viabilidade {
  if (f.plataforma === "win32") {
    return {
      redroid: { serve: false, motivo: MOTIVO_WINDOWS },
      emulador: { serve: false, motivo: MOTIVO_WINDOWS },
    };
  }
  const redroid = !f.docker
    ? { serve: false, motivo: "Não há Docker neste PC. O redroid roda em container, e mesmo com Docker precisa do binder no kernel." }
    : f.wsl && !f.binder
      ? { serve: false, motivo: "Este WSL2 não tem /dev/binder. O kernel padrão não inclui CONFIG_ANDROID_BINDER_IPC, e o redroid não sobe sem isso." }
      : !f.binder
        ? { serve: false, motivo: "O kernel não tem binder (/dev/binder ou binderfs). O redroid exige esse módulo; ashmem sozinho não basta nas imagens atuais." }
        : { serve: true, motivo: f.ashmem ? "Docker e binder presentes." : "Docker e binder presentes. Ashmem não apareceu; o redroid 12 usa memfd e pode seguir sem ele." };
  const emulador = !f.docker
    ? { serve: false, motivo: "Não há Docker neste PC. O emulador em container precisa de Docker e de /dev/kvm." }
    : !f.kvm
      ? { serve: false, motivo: "Não há /dev/kvm. Sem a virtualização aninhada o emulador não tem velocidade útil." }
      : { serve: true, motivo: "Docker e /dev/kvm presentes. A imagem é grande e o aparelho real continua preferível." };
  return { redroid, emulador };
}

export function fatosDesteHost(): Omit<FatosDoHost, "docker"> & { docker: boolean } {
  let versao = "";
  try { versao = fs.readFileSync("/proc/version", "utf8"); } catch { /* Windows não tem */ }
  const wsl = process.platform === "win32" || /microsoft/i.test(versao) || !!process.env.WSL_DISTRO_NAME;
  return {
    plataforma: process.platform,
    wsl,
    docker: false,
    binder: fs.existsSync("/dev/binder") || fs.existsSync("/dev/binderfs"),
    ashmem: fs.existsSync("/dev/ashmem"),
    kvm: fs.existsSync("/dev/kvm"),
  };
}

export function dockerNoAr(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 15000, windowsHide: true }, (e) => resolve(!e));
  });
}

export async function avaliarEsteHost(): Promise<Viabilidade & { fatos: FatosDoHost }> {
  const fatos: FatosDoHost = { ...fatosDesteHost(), docker: await dockerNoAr() };
  return { ...avaliarFallback(fatos), fatos };
}

export function nomeDoContainerAndroid(botId: string): string {
  return "mybots-android-" + botId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 40);
}

/**
 * O `docker run` do fallback. A porta do host é só 127.0.0.1.
 * 8787 e 8791 são recusadas aqui também.
 */
export function argumentosDocker(modo: "redroid" | "emulador", botId: string, portaHost: number): string[] {
  if (portaHost === 8787 || portaHost === 8791 || portaHost === 8790) {
    throw new Error(`a porta ${portaHost} não serve para o Android`);
  }
  const nome = nomeDoContainerAndroid(botId);
  const publicar = `127.0.0.1:${portaHost}:5555`;
  if (modo === "redroid") {
    return [
      "run", "-d", "--name", nome, "--restart", "unless-stopped", "--privileged",
      "-p", publicar, IMAGEM_REDROID,
      "androidboot.redroid_width=720",
      "androidboot.redroid_height=1280",
      "androidboot.redroid_dpi=320",
      "androidboot.redroid_fps=30",
    ];
  }
  return [
    "run", "-d", "--name", nome, "--restart", "unless-stopped",
    "--device", "/dev/kvm",
    "-p", publicar,
    "-e", "EMULATOR_DEVICE=Samsung Galaxy S10",
    IMAGEM_EMULADOR,
  ];
}

export function modoFallbackDoAmbiente(env: NodeJS.ProcessEnv = process.env): "redroid" | "emulador" | null {
  const v = String(env.MYBOTS_ANDROID_FALLBACK ?? "").trim().toLowerCase();
  if (v === "redroid" || v === "emulador") return v;
  return null;
}
