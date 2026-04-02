import { featureFlags } from '../config/feature-flags';

// Configurable via environment variables
const FAILURE_RATE = parseFloat(process.env.FAILURE_RATE ?? '0.05');
const SLOW_RATE = parseFloat(process.env.SLOW_RATE ?? '0.10');

const BASE_TIMES: Record<string, number> = {
  'data-processing': 5000,
  'email': 2000,
  'report': 8000,
  'analysis': 10000,
  'notification': 1000,
  'export': 6000,
  'import': 7000,
};

const STAGE_COUNTS: Record<string, number> = {
  'data-processing': 3,
  'email': 1,
  'report': 4,
  'analysis': 5,
  'notification': 1,
  'export': 3,
  'import': 4,
};

// Critical tasks get expedited; low-priority tasks are slower
const PRIORITY_MULTIPLIERS: Record<string, number> = {
  'Critical': 0.5,
  'High': 0.75,
  'Medium': 1.0,
  'Low': 1.5,
};

export class TaskSimulator {
  static async simulateProcessing(taskType: string, priority?: string): Promise<void> {
    const base = BASE_TIMES[taskType] ?? 3000;
    const variation = base * 0.4 * (Math.random() - 0.5);
    // Slow-path only fires when randomization is enabled
    const slowMultiplier = featureFlags.randomization && Math.random() < SLOW_RATE ? 3 : 1;
    const priorityMultiplier = PRIORITY_MULTIPLIERS[priority ?? 'Medium'] ?? 1.0;

    const totalTime = Math.max(500, Math.round((base + variation) * slowMultiplier * priorityMultiplier));
    const stages = STAGE_COUNTS[taskType] ?? 2;
    const stageTime = Math.round(totalTime / stages);

    if (slowMultiplier > 1) {
      console.log(`[${taskType}/${priority ?? 'unknown'}] ⚠ Slow-processing path — ${totalTime}ms over ${stages} stages`);
    } else {
      console.log(`[${taskType}/${priority ?? 'unknown'}] Starting ${stages}-stage processing (~${totalTime}ms total)`);
    }

    for (let i = 1; i <= stages; i++) {
      // Add per-stage jitter of ±30%
      const jitter = Math.round(stageTime * 0.3 * (Math.random() - 0.5));
      await this.delay(Math.max(200, stageTime + jitter));
      console.log(`[${taskType}] Stage ${i}/${stages} complete`);
    }

    if (Math.random() < FAILURE_RATE) {
      throw new Error(
        `Simulated processing failure for ${taskType} (FAILURE_RATE=${FAILURE_RATE})`,
      );
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}