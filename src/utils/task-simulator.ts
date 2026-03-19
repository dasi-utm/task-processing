export class TaskSimulator {
  static async simulateProcessing(taskType: string): Promise<void> {
    const processingTime = this.getProcessingTime(taskType);
    
    console.log(`Simulating ${taskType} processing for ${processingTime}ms`);
    
    // Simulate processing delay
    await this.delay(processingTime);
    
    // Simulate occasional failures (5% chance)
    if (Math.random() < 0.05) {
      throw new Error(`Simulated processing failure for ${taskType}`);
    }
  }

  private static getProcessingTime(taskType: string): number {
    const baseTime = {
      'data-processing': 5000,  // 5 seconds
      'email': 2000,           // 2 seconds
      'report': 8000,          // 8 seconds
      'analysis': 10000        // 10 seconds
    };

    const base = baseTime[taskType] || 3000;
    const variation = base * 0.5 * (Math.random() - 0.5);
    
    return Math.max(2000, base + variation);
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}