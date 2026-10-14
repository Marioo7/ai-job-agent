import { COLLECTIONS } from '@ajaa/shared';
import type { Db } from '../db/types';
import { AiError, type AiProvider } from './types';

/** Runs an AI call only if AI is enabled globally + by the user, and the daily call cap is not exceeded. */
export async function aiCall<T>(deps: { db: Db; ai: AiProvider; aiDailyCap: number }, uid: string, userAiEnabled: boolean, fn: () => Promise<T>): Promise<T | null> {
  if (!deps.ai.enabled || !userAiEnabled) return null;
  if (!deps.ai.isMock) {
    const id = `${uid}_${new Date().toISOString().slice(0, 10)}`;
    const cur = (await deps.db.get<{ count: number }>(COLLECTIONS.aiUsage, id))?.count ?? 0;
    if (cur >= deps.aiDailyCap) throw new AiError('daily_cap', `Daily AI call cap (${deps.aiDailyCap}) reached.`);
    await deps.db.set(COLLECTIONS.aiUsage, id, { id, uid, count: cur + 1 });
  }
  return fn();
}
