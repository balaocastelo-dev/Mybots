import type { FastifyInstance } from "fastify";
import { listarParaUi, materializar, prepararNascimento } from "@mybots/soul-bank";

/** Lista o banco para o seletor "Nascer com alma". O nascimento em si entra no BotManager. */
export function registrarAlmas(app: FastifyInstance) {
  app.get("/api/almas", async () => listarParaUi());
}

export { materializar, prepararNascimento };
