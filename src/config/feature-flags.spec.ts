describe('feature-flags', () => {
  const savedEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...savedEnv };
    // Suppress the startup log that fires on every module load
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    process.env = savedEnv;
    jest.restoreAllMocks();
  });

  // Helper — re-require the module with the current env
  function loadFlags() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./feature-flags').featureFlags as { randomization: boolean };
  }

  describe('featureFlags.randomization', () => {
    it('defaults to true when env var is not set', () => {
      delete process.env.FEATURE_RANDOMIZATION_ENABLED;
      expect(loadFlags().randomization).toBe(true);
    });

    it('defaults to true when env var is an empty string', () => {
      process.env.FEATURE_RANDOMIZATION_ENABLED = '';
      expect(loadFlags().randomization).toBe(true);
    });

    it.each([
      ['true'],
      ['True'],
      ['TRUE'],
      ['1'],
    ])('is true when FEATURE_RANDOMIZATION_ENABLED="%s"', (value) => {
      process.env.FEATURE_RANDOMIZATION_ENABLED = value;
      expect(loadFlags().randomization).toBe(true);
    });

    it.each([
      ['false'],
      ['False'],
      ['FALSE'],
      ['0'],
    ])('is false when FEATURE_RANDOMIZATION_ENABLED="%s"', (value) => {
      process.env.FEATURE_RANDOMIZATION_ENABLED = value;
      expect(loadFlags().randomization).toBe(false);
    });
  });

  describe('startup log', () => {
    it('logs the effective flag value on module load', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      process.env.FEATURE_RANDOMIZATION_ENABLED = 'false';

      loadFlags();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('FEATURE_RANDOMIZATION_ENABLED=false'),
      );
    });

    it('logs true when flag is enabled', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      process.env.FEATURE_RANDOMIZATION_ENABLED = 'true';

      loadFlags();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('FEATURE_RANDOMIZATION_ENABLED=true'),
      );
    });
  });
});
