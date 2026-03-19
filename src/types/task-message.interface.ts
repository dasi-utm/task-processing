// Event schema published by the .NET TaskManager.API on the task-events exchange
export interface TaskMessage {
  eventType: 'TaskCreated' | 'TaskUpdated' | 'TaskDeleted' | 'TaskStatusChanged';
  timestamp: string;
  correlationId: string;
  payload: {
    taskId: string;
    // Present on TaskCreated / TaskUpdated
    title?: string;
    createdBy?: string;
    // Present on TaskStatusChanged
    oldStatus?: string;
    newStatus?: string;
  };
}
