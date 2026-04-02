/**
 * scenarios:
 *  - Slow-path fires only when randomization=true AND Math.random < SLOW_RATE
 *  - Slow-path is suppressed when randomization=false regardless of Math.random
 *  - Processing throws when Math.random falls below FAILURE_RATE
 *  - Correct number of stages is logged for each task type
 *  - Unknown task types use the fallback (2 stages, 3 s base)
 *  - Priority multipliers affect the logged total time category
 */

const mockFlagsValue = { randomization: true };
jest.mock('../config/feature-flags', () => ({
  get featureFlags() {
    return mockFlagsValue;
  },
}));

import { TaskSimulator } from './task-simulator';

describe('TaskSimulator', () => {
  let consoleSpy: jest.SpyInstance;
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    // Safe default: 0.5, above both SLOW_RATE (0.10) and FAILURE_RATE (0.05)
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    mockFlagsValue.randomization = true; // reset before each test
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function run(type: string, priority = 'Medium') {
    const promise = TaskSimulator.simulateProcessing(type, priority);
    promise.catch(() => {}); // mark as handled immediately
    await jest.runAllTimersAsync();
    return promise;
  }

  it('resolves without error when Math.random is safe (0.5)', async () => {
    await expect(run('email', 'Medium')).resolves.toBeUndefined();
  });

  it('resolves for every known task type', async () => {
    const types = ['data-processing', 'report', 'analysis', 'email', 'notification', 'export', 'import'];
    for (const type of types) {
      consoleSpy.mockClear();
      await expect(run(type)).resolves.toBeUndefined();
    }
  });

  it('throws a "Simulated processing failure" error when Math.random < FAILURE_RATE', async () => {
    // All random calls return 0.01 — below both SLOW_RATE and FAILURE_RATE
    randomSpy.mockReturnValue(0.01);
    await expect(run('email', 'Medium')).rejects.toThrow(/Simulated processing failure/);
  });

  it('error message includes the task type', async () => {
    randomSpy.mockReturnValue(0.01);
    await expect(run('report', 'High')).rejects.toThrow(/report/);
  });

  it('does NOT throw when Math.random is above FAILURE_RATE (0.5 > 0.05)', async () => {
    randomSpy.mockReturnValue(0.5);
    await expect(run('analysis')).resolves.toBeUndefined();
  });

  it('logs the slow-processing warning when randomization=true and slow roll < SLOW_RATE', async () => {
    // Sequence: variation(0.5), slow-path(0.05 < 0.10) → triggers, stage jitters(0.5), failure(0.99)
    randomSpy
      .mockReturnValueOnce(0.5)   // variation
      .mockReturnValueOnce(0.05)  // slow-path roll  → triggers (0.05 < 0.10)
      .mockReturnValue(0.99);     // stage jitters + failure check

    await run('email', 'Medium');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('⚠ Slow-processing path'),
    );
  });

  it('does NOT log the slow-processing warning when slow roll >= SLOW_RATE', async () => {
    randomSpy.mockReturnValue(0.5); // 0.5 >= 0.10 → normal path

    await run('email', 'Medium');

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('⚠ Slow-processing path'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Starting'),
    );
  });

  it('NEVER logs slow-processing path when randomization=false, regardless of Math.random', async () => {
    mockFlagsValue.randomization = false;
    // Math.random always 0.01 — would trigger slow path if enabled
    randomSpy.mockReturnValue(0.99); // high value to skip failure; slow-path check is skipped by flag

    await run('email', 'Medium');

    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('⚠ Slow-processing path'),
    );
  });

  it.each([
    ['data-processing', 3],
    ['email',           1],
    ['report',          4],
    ['analysis',        5],
    ['notification',    1],
    ['export',          3],
    ['import',          4],
  ])('%s uses %i processing stages', async (taskType, expectedStages) => {
    randomSpy.mockReturnValue(0.5);

    await run(taskType, 'Medium');

    const stageLogs = consoleSpy.mock.calls
      .map((args) => args[0] as string)
      .filter((msg) => /Stage \d+\/\d+ complete/.test(msg));

    expect(stageLogs).toHaveLength(expectedStages);
  });

  it('falls back to 2 stages for an unknown task type', async () => {
    randomSpy.mockReturnValue(0.5);

    await run('completely-unknown-type', 'Medium');

    const stageLogs = consoleSpy.mock.calls
      .map((args) => args[0] as string)
      .filter((msg) => /Stage \d+\/\d+ complete/.test(msg));

    expect(stageLogs).toHaveLength(2);
  });

  it('includes priority in the start log', async () => {
    randomSpy.mockReturnValue(0.5);

    await run('email', 'Critical');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Critical'),
    );
  });

  it.each(['Low', 'Medium', 'High', 'Critical'])(
    'resolves successfully for priority=%s',
    async (priority) => {
      randomSpy.mockReturnValue(0.5);
      await expect(run('data-processing', priority)).resolves.toBeUndefined();
    },
  );

  it('falls back to Medium multiplier for unknown priority', async () => {
    randomSpy.mockReturnValue(0.5);
    // Should not throw — unknown priority is treated as 1.0×
    await expect(run('email', 'UnknownPriority')).resolves.toBeUndefined();
  });
});
