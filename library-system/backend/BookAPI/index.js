const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://library:library@postgres:5432/librarydb'
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'BookAPI' }));

// Get all books with pagination
app.get('/books', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    const result = await pool.query(
      'SELECT * FROM books LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    res.json({ page, limit, books: result.rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Search books by title or author
app.get('/books/search/:query', async (req, res) => {
  try {
    const q = `%${req.params.query}%`;
    const result = await pool.query(
      'SELECT * FROM books WHERE title ILIKE $1 OR author ILIKE $1 LIMIT 50',
      [q]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get book by ID
app.get('/books/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM books WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Book not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Create book
app.post('/books', async (req, res) => {
  try {
    const { title, author, isbn, description, copies_total } = req.body;
    if (!title || !author) return res.status(400).json({ error: 'Missing title/author' });
    
    const result = await pool.query(
      'INSERT INTO books (title, author, isbn, description, copies_total, copies_available) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *',
      [title, author, isbn, description, copies_total || 1]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update book
app.put('/books/:id', async (req, res) => {
  try {
    const { title, author, description, copies_total } = req.body;
    const result = await pool.query(
      'UPDATE books SET title = COALESCE($1, title), author = COALESCE($2, author), description = COALESCE($3, description), copies_total = COALESCE($4, copies_total), updated_at = now() WHERE id = $5 RETURNING *',
      [title, author, description, copies_total, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Book not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete book
app.delete('/books/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM books WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Book not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`BookAPI listening on ${PORT}`));
