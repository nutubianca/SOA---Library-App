
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const amqp = require('amqplib');
const { Kafka } = require('kafkajs');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || 'library-secret-key-change-in-prod';

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing token' });
  const token = auth.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let channel;
const connectedClients = new Set();
const sseClients = new Set();

const dedupeCache = new Map();
const DEDUPE_TTL_MS = 2 * 60 * 1000;

function logDuplicate(event, source) {
  try {
    console.log(`NotificationAPI: duplicate event ignored (${source})`, {
      event: event?.event,
      borrow_id: event?.borrow_id,
      timestamp: event?.timestamp,
    });
  } catch (e) {
    // ignore
  }
}

function shouldProcessEvent(event) {
  const key = `${event?.event || 'unknown'}|${event?.borrow_id || ''}|${event?.timestamp || ''}`;
  const now = Date.now();

  for (const [k, expiresAt] of dedupeCache.entries()) {
    if (expiresAt <= now) dedupeCache.delete(k);
  }

  if (dedupeCache.has(key)) return false;
  dedupeCache.set(key, now + DEDUPE_TTL_MS);
  return true;
}

function broadcastLibraryEvent(event, source) {
  const payload = {
    type: event.event,
    data: { ...event, source },
    timestamp: new Date().toISOString(),
  };

  // WebSocket broadcast
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  });

  // SSE broadcast
  const sseData = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((res) => {
    try {
      res.write(sseData);
    } catch (e) {
      // client is gone; cleaned up on close
    }
  });
}

async function initRabbitMQ() {
  try {
    const conn = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq');
    channel = await conn.createChannel();
    
    const exchange = 'library.events';
    await channel.assertExchange(exchange, 'topic', { durable: true });
    
    const q = await channel.assertQueue('notification-service', { durable: true });
    await channel.bindQueue(q.queue, exchange, 'book.*');
    
    await channel.consume(q.queue, (msg) => {
      if (!msg) return;

      try {
        const event = JSON.parse(msg.content.toString());
        if (shouldProcessEvent(event)) {
          console.log('NotificationAPI: received RabbitMQ event:', event);
          broadcastLibraryEvent(event, 'rabbitmq');
        } else {
          logDuplicate(event, 'rabbitmq');
        }
      } catch (e) {
        console.error('NotificationAPI: RabbitMQ message parse failed:', e.message);
      } finally {
        channel.ack(msg);
      }
    });
    
    console.log('NotificationAPI: RabbitMQ connected and consuming events');
  } catch (err) {
    console.error('NotificationAPI: RabbitMQ connection failed:', err.message);
    setTimeout(initRabbitMQ, 5000);
  }
}
initRabbitMQ();

let kafkaConsumer;
const kafkaBrokers = (process.env.KAFKA_BROKERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const kafkaTopic = process.env.KAFKA_TOPIC || 'library.events';

async function initKafka() {
  if (kafkaBrokers.length === 0) {
    console.log('NotificationAPI: Kafka disabled (no KAFKA_BROKERS provided)');
    return;
  }

  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'notificationapi',
    brokers: kafkaBrokers,
  });

  kafkaConsumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID || 'notificationapi-group' });

  const connectWithRetry = async () => {
    try {
      await kafkaConsumer.connect();
      await kafkaConsumer.subscribe({ topic: kafkaTopic, fromBeginning: false });

      await kafkaConsumer.run({
        eachMessage: async ({ message }) => {
          try {
            const value = message?.value?.toString();
            if (!value) return;
            const event = JSON.parse(value);
            if (shouldProcessEvent(event)) {
              console.log('NotificationAPI: received Kafka event:', event);
              broadcastLibraryEvent(event, 'kafka');
            } else {
              logDuplicate(event, 'kafka');
            }
          } catch (e) {
            console.error('NotificationAPI: Kafka message handling failed:', e.message);
          }
        },
      });

      console.log(`NotificationAPI: Kafka connected (${kafkaBrokers.join(', ')}) and consuming ${kafkaTopic}`);
    } catch (err) {
      console.error('NotificationAPI: Kafka connection failed:', err.message);
      setTimeout(connectWithRetry, 5000);
    }
  };

  connectWithRetry();
}

initKafka();

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'NotificationAPI' }));

// SSE endpoint (JWT-protected)
app.get('/events', authMiddleware, (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Initial event so clients know we're connected
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);

  sseClients.add(res);

  const keepAlive = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    } catch (e) {
      // ignore
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

wss.on('connection', (ws, req) => {
  // JWT auth for WebSocket: expect token as ?token=... in URL
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }
  try {
    jwt.verify(token, JWT_SECRET);
  } catch (err) {
    ws.close(4002, 'Invalid token');
    return;
  }
  console.log('NotificationAPI: new WebSocket client connected');
  connectedClients.add(ws);
  ws.on('close', () => {
    console.log('NotificationAPI: client disconnected');
    connectedClients.delete(ws);
  });
  ws.on('error', (err) => {
    console.error('NotificationAPI: WebSocket error:', err.message);
    connectedClients.delete(ws);
  });
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => console.log(`NotificationAPI listening on ${PORT}`));

async function shutdown() {
  try {
    if (kafkaConsumer) await kafkaConsumer.disconnect();
  } catch (e) {
    // ignore
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
