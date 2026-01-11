const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://library:library@postgres:5432/librarydb'
});

let channel;

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

// Borrow a book
app.post('/borrow', async (req, res) => {
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
    // Publish event
    if (channel) {
      await channel.publish('library.events', 'book.borrowed', Buffer.from(JSON.stringify({
        event: 'book.borrowed',
        borrow_id: result.rows[0].id,
        user_id,
        book_id,
        timestamp: new Date().toISOString()
      })));
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Return a book
app.post('/return', async (req, res) => {
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
    // Publish event
    if (channel) {
      await channel.publish('library.events', 'book.returned', Buffer.from(JSON.stringify({
        event: 'book.returned',
        borrow_id,
        user_id: result.rows[0].user_id,
        book_id: result.rows[0].book_id,
        timestamp: new Date().toISOString()
      })));
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`BorrowAPI listening on ${PORT}`));
