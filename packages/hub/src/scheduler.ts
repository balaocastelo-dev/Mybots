// Rotinas: "toda segunda às 8h, Robertinho confere o o ERP". Expressão cron de 5 campos, fuso do PC do Hub.
import cronParser from "cron-parser";
import type { Routine } from "@mybots/shared";
import type { Hub } from "./hub.js";

export function nextRunOf(cron: string, from = new Date()): number {
  return cronParser.parseExpression(cron, { currentDate: from }).next().getTime();
}

export function validateCron(cron: string): string | null {
  try { cronParser.parseExpression(cron); return null; } catch (e) { return (e as Error).message; }
}

export function startScheduler(hub: Hub, intervalMs = 30_000) {
  const tick = () => {
    const now = Date.now();
    for (const r of hub.db.listRoutines()) {
      if (!r.enabled) continue;
      if (!r.nextRun) { hub.db.updateRoutine(r.id, { nextRun: safeNext(r) }); continue; }
      if (r.nextRun <= now) {
        hub.fireRoutine(r, "agendada");
        hub.db.updateRoutine(r.id, { lastRun: now, nextRun: safeNext(r, new Date(now)) });
      }
    }
    hub.broadcastRoutines();
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}

function safeNext(r: Routine, from = new Date()): number | undefined {
  try { return nextRunOf(r.cron, from); } catch { return undefined; }
}
