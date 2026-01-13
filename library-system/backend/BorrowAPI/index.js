
const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const { Kafka } = require('kafkajs');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://library:library@postgres:5432/librarydb'
});

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

let channel;
let kafkaProducer;
const kafkaBrokers = (process.env.KAFKA_BROKERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const kafkaTopic = process.env.KAFKA_TOPIC || 'library.events';

async function initRabbitMQ() {
  try {
    const conn = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq');
    channel = await conn.createChannel();
    await channel.assertExchange('library.events', 'topic', { durable: true });
    console.log('BorrowAPI: RabbitMQ connected');
  } catch (err) {
    console.error('BorrowAPI: RabbitMQ connection failed:', err.message);
    setTimeout(initRabbitMQ, 5000);
  }
}
initRabbitMQ();

async function initKafka() {
  if (kafkaBrokers.length === 0) {
    console.log('BorrowAPI: Kafka disabled (no KAFKA_BROKERS provided)');
    return;
  }

  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'borrowapi',
    brokers: kafkaBrokers,
  });

  kafkaProducer = kafka.producer();

  const connectWithRetry = async () => {
    try {
      await kafkaProducer.connect();
      console.log(`BorrowAPI: Kafka connected (${kafkaBrokers.join(', ')})`);
    } catch (err) {
      console.error('BorrowAPI: Kafka connection failed:', err.message);
      setTimeout(connectWithRetry, 5000);
    }
  };

  connectWithRetry();
}

async function publishKafkaEvent(key, eventPayload) {
  if (!kafkaProducer) return;
  try {
    await kafkaProducer.send({
      topic: kafkaTopic,
      messages: [{ key, value: JSON.stringify(eventPayload) }],
    });
  } catch (err) {
    console.error('BorrowAPI: Kafka publish failed:', err.message);
  }
}

initKafka();

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'BorrowAPI' }));

// Get all borrows for a user
app.get('/borrows/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT b.*, bk.title, bk.author FROM borrows b JOIN books bk ON b.book_id = bk.id WHERE b.user_id = $1 ORDER BY b.borrowed_at DESC',
      [req.params.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


// Borrow a book (protected)
app.post('/borrow', authMiddleware, async (req, res) => {
  try {
    const { user_id, book_id, due_days } = req.body;
    if (!user_id || !book_id) return res.status(400).json({ error: 'Missing user_id or book_id' });
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + (due_days || 14));
    // Decrement copies_available if possible
    const updateResult = await pool.query(
      'UPDATE books SET copies_available = copies_available - 1 WHERE id = $1 AND copies_available > 0 RETURNING *',
      [book_id]
    );
    if (updateResult.rows.length === 0) {
      return res.status(400).json({ error: 'No available copies to borrow' });
    }
    const result = await pool.query(
      'INSERT INTO borrows (user_id, book_id, due_at) VALUES ($1, $2, $3) RETURNING *',
      [user_id, book_id, dueAt]
    );
    const book = updateResult.rows[0];

    const eventPayload = {
      event: 'book.borrowed',
      borrow_id: result.rows[0].id,
      user_id,
      book_id,
      title: book.title,
      author: book.author,
      due_at: result.rows[0].due_at,
      borrowed_at: result.rows[0].borrowed_at,
      timestamp: new Date().toISOString(),
    };

    // Publish event (RabbitMQ + Kafka)
    if (channel) {
      try {
        channel.publish('library.events', 'book.borrowed', Buffer.from(JSON.stringify(eventPayload)));
      } catch (e) {
        console.error('BorrowAPI: RabbitMQ publish failed:', e.message);
      }
    }
    await publishKafkaEvent('book.borrowed', eventPayload);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Return a book (protected)
app.post('/return', authMiddleware, async (req, res) => {
  try {
    const { borrow_id } = req.body;
    if (!borrow_id) return res.status(400).json({ error: 'Missing borrow_id' });
    // Mark as returned
    const result = await pool.query(
      'UPDATE borrows SET returned_at = now(), updated_at = now() WHERE id = $1 AND returned_at IS NULL RETURNING *',
      [borrow_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Borrow not found or already returned' });
    // Increment copies_available for the book
    await pool.query(
      'UPDATE books SET copies_available = copies_available + 1 WHERE id = $1',
      [result.rows[0].book_id]
    );
    const bookResult = await pool.query('SELECT title, author FROM books WHERE id = $1', [result.rows[0].book_id]);
    const book = bookResult.rows[0] || {};

    const eventPayload = {
      event: 'book.returned',
      borrow_id,
      user_id: result.rows[0].user_id,
      book_id: result.rows[0].book_id,
      title: book.title,
      author: book.author,
      returned_at: result.rows[0].returned_at,
      timestamp: new Date().toISOString(),
    };

    // Publish event (RabbitMQ + Kafka)
    if (channel) {
      try {
        channel.publish('library.events', 'book.returned', Buffer.from(JSON.stringify(eventPayload)));
      } catch (e) {
        console.error('BorrowAPI: RabbitMQ publish failed:', e.message);
      }
    }
    await publishKafkaEvent('book.returned', eventPayload);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3002;
const server = app.listen(PORT, () => console.log(`BorrowAPI listening on ${PORT}`));

async function shutdown() {
  try {
    if (kafkaProducer) await kafkaProducer.disconnect();
  } catch (e) {
    // ignore
  }
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
