# task-processing

Worker microservice for the distributed task management system. It consumes `task.created` events from RabbitMQ, simulates processing based on task type, and publishes status lifecycle events (`task.processing`, `task.completed`, `task.failed`) back to the exchange. Includes retry logic with exponential backoff and a dead-letter queue for permanently failed messages.

## Table of contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Docker](#docker)
- [Message queue](#message-queue)
- [Processing behaviour](#processing-behaviour)
- [Project structure](#project-structure)
- [Inter-service dependencies](#inter-service-dependencies)

---

## Architecture

```
RabbitMQ (task-events exchange)
        │
        │  task.created  (routing key)
        ▼
 task-processing-queue
        │
        ▼
  task-consumer           ← prefetch 1 (fair dispatch)
        │
        │  retry up to 3x with exponential backoff
        ▼
  task-processor
        │
        ├─ success ──► publish task.completed  ──► task-events exchange
        │
        └─ failure ──► publish task.failed     ──► task-events exchange
                          │
                    (after 3 retries)
                          ▼
                    task-dlq-queue
```

This service is **purely event-driven** — it exposes no HTTP endpoints.

---

## Prerequisites

- Node.js >= 20
- npm >= 10
- RabbitMQ 3

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env   # or create .env manually (see below)

# 3. Start in development mode (NestJS watch mode)
npm run start:dev
```

---

## Environment variables

Create a `.env` file in the project root:

```env
PORT=3002
NODE_ENV=development
RABBITMQ_URL=amqp://localhost:5672
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3002` | HTTP server port (process control only, no API) |
| `NODE_ENV` | No | `development` | Runtime environment |
| `RABBITMQ_URL` | Yes | `amqp://localhost:5672` | RabbitMQ connection string |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start with NestJS watch mode (hot reload) |
| `npm start` | Start compiled output (`dist/main`) |
| `npm run build` | Compile TypeScript via NestJS CLI to `dist/` |

---

## Docker

Compose files live in `deployment/containers`. The `Dockerfile` uses multi-stage builds — `target` selects the environment.

**Development** (source mounted, hot reload):

```bash
docker compose -f deployment/containers/docker-compose.dev.yml up
```

**Production** (compiled image, no bind mounts, no management UI):

```bash
# Copy and fill in required secrets first
cp deployment/config/.env.template deployment/config/.env.prod

docker compose -f deployment/containers/docker-compose.prod.yml --env-file deployment/config/.env.prod up
```

Required env vars for prod: `RABBITMQ_URL`, `RABBITMQ_PASSWORD`.

**Build the production image standalone:**

```bash
docker build --target production -t task-processing .
docker run -p 3002:3002 \
  -e RABBITMQ_URL=amqp://... \
  task-processing
```
---

## Message queue

**Exchange:** `task-events` (topic, durable)

### Consumed

| Queue | Routing key | Source |
|-------|-------------|--------|
| `task-processing-queue` | `task.created` | .NET API |
| `task-dlq-queue` | — | Dead-letter from main queue |

### Published

| Routing key | When |
|-------------|------|
| `task.processing` | Processing begins |
| `task.completed` | Task finishes successfully |
| `task.failed` | All retries exhausted |

**Incoming message shape:**

```ts
{
  eventType: 'TaskCreated';
  timestamp: string;       // ISO 8601
  correlationId: string;
  payload: {
    taskId: string;
    title?: string;
    createdBy?: string;
  };
}
```

---

## Processing behaviour

### Concurrency

Prefetch is set to **1** — each worker processes one task at a time, enabling fair dispatch across multiple service replicas.

### Simulated processing times

Processing time is randomised to ± 50% around a base duration per task type:

| Task type | Base duration |
|-----------|--------------|
| `data-processing` | 5 s |
| `report` | 8 s |
| `analysis` | 10 s |
| `email` | 2 s |
| _(unknown)_ | 3 s |

### Failure simulation

A **5% random failure rate** is injected during processing to exercise the retry and dead-letter paths in development and testing.

### Retry policy

| Attempt | Delay before retry |
|---------|--------------------|
| 1st retry | 2 s |
| 2nd retry | 4 s |
| 3rd retry | 8 s |
| After 3rd failure | Message rejected → `task-dlq-queue` |

---

## Project structure

```
src/
├── config/
│   ├── rabbitmq.ts              # Channel setup, exchange/queue/binding declarations
│   └── rabbitmq.module.ts       # NestJS microservices RMQ transport + DI token
├── consumers/
│   ├── task-consumer.service.ts # Queue consumer, retry logic, event publisher
│   └── task-consumer.module.ts
├── processors/
│   ├── task-processor.service.ts   # Orchestrates TaskSimulator and publishes result events
│   └── processor.module.ts
├── types/
│   └── task-message.interface.ts   # TaskMessage interface matching .NET event schema
├── utils/
│   └── task-simulator.ts        # Static helpers: processing time + failure injection
├── app.module.ts
└── main.ts
```

---

## Inter-service dependencies

| Dependency | Role |
|------------|------|
| RabbitMQ (`task-events` exchange) | Consumes `task.created`; publishes `task.processing`, `task.completed`, `task.failed` |
| task-analytics | Downstream consumer of the events this service publishes |

This service does **not** connect to any database.
