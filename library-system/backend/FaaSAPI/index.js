const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Very small “FaaS” style API: invoke named functions over HTTP.
// Routed via NGINX -> APIGateway -> this service as /faasapi/*.

const functions = {
  echo: async (input) => ({ output: input ?? null }),
  add: async (input) => {
    const a = Number(input?.a);
    const b = Number(input?.b);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return { error: 'Invalid numbers. Expected JSON like {"a":1,"b":2}' };
    }
    return { output: a + b };
  },
  daysUntil: async (input) => {
    const now = input?.from ? new Date(String(input.from)) : new Date();
    if (Number.isNaN(now.getTime())) {
      return { error: 'Invalid from date. Expected ISO string like "2026-01-14T00:00:00.000Z"' };
    }

    const compute = (toRaw) => {
      const to = new Date(String(toRaw));
      if (Number.isNaN(to.getTime())) return null;
      const ms = to.getTime() - now.getTime();
      // Round up so that e.g. 0.2 days remaining shows as 1 day.
      const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
      return {
        days,
        overdue: days < 0,
        due_at: to.toISOString(),
        due_date: to.toISOString().slice(0, 10),
      };
    };

    if (Array.isArray(input?.dates)) {
      const results = input.dates.map((d) => compute(d));
      if (results.some((r) => r === null)) {
        return { error: 'One or more dates are invalid ISO strings' };
      }
      return { output: results };
    }

    const single = compute(input?.to ?? input?.date);
    if (!single) {
      return { error: 'Invalid date. Expected JSON like {"to":"2026-01-20T00:00:00.000Z"} or {"dates":[...]} ' };
    }
    return { output: single };
  },
  dueDate: async (input) => {
    const days = Number(input?.days);
    if (!Number.isFinite(days)) {
      return { error: 'Invalid days. Expected JSON like {"days":14}' };
    }
    const wholeDays = Math.trunc(days);
    if (wholeDays < 1 || wholeDays > 90) {
      return { error: 'days must be between 1 and 90' };
    }

    const from = input?.from ? new Date(String(input.from)) : new Date();
    if (Number.isNaN(from.getTime())) {
      return { error: 'Invalid from date. Expected ISO string like "2026-01-14T00:00:00.000Z"' };
    }

    const due = new Date(from.getTime() + wholeDays * 24 * 60 * 60 * 1000);
    const due_date = due.toISOString().slice(0, 10);
    return { output: { due_at: due.toISOString(), due_date, days: wholeDays } };
  },
  wordcount: async (input) => {
    const text = String(input?.text ?? '');
    const words = text.trim() ? text.trim().split(/\s+/) : [];
    return { output: { words: words.length, characters: text.length } };
  },
};

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'FaaSAPI' }));

app.get('/functions', (req, res) => {
  res.json({ functions: Object.keys(functions).sort() });
});

app.post('/invoke/:name', async (req, res) => {
  const name = req.params.name;
  const fn = functions[name];
  if (!fn) {
    return res.status(404).json({ error: `Unknown function: ${name}`, available: Object.keys(functions).sort() });
  }

  try {
    const startedAt = Date.now();
    const result = await fn(req.body);
    const duration_ms = Date.now() - startedAt;

    if (result && typeof result === 'object' && result.error) {
      return res.status(400).json({ ok: false, function: name, duration_ms, ...result });
    }

    return res.json({ ok: true, function: name, duration_ms, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, function: name, error: err.message || 'Function failed' });
  }
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => console.log(`FaaSAPI listening on ${PORT}`));
