const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || 'library-secret-key-change-in-prod';

// JWT auth middleware (for protected routes)
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

// Proxy config
const targets = {
  userapi: 'http://userapi:3000',
  bookapi: 'http://bookapi:3001',
  borrowapi: 'http://borrowapi:3002',
  notificationapi: 'http://notificationapi:3003',
  faasapi: 'http://faasapi:3004',
};

function serviceProxy(prefix, target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(new RegExp(`^/${prefix}`), ''),
  });
}

// Public UserAPI routes (no auth)
app.post('/userapi/login', serviceProxy('userapi', targets.userapi));
app.post('/userapi/register', serviceProxy('userapi', targets.userapi));
app.get('/userapi/health', serviceProxy('userapi', targets.userapi));

// Public health routes for other services
app.get('/bookapi/health', serviceProxy('bookapi', targets.bookapi));
app.get('/borrowapi/health', serviceProxy('borrowapi', targets.borrowapi));
app.get('/notificationapi/health', serviceProxy('notificationapi', targets.notificationapi));
app.get('/faasapi/health', serviceProxy('faasapi', targets.faasapi));

// Protected routes
app.use('/userapi', authMiddleware, serviceProxy('userapi', targets.userapi));
app.use('/bookapi', authMiddleware, serviceProxy('bookapi', targets.bookapi));
app.use('/borrowapi', authMiddleware, serviceProxy('borrowapi', targets.borrowapi));
app.use('/notificationapi', authMiddleware, serviceProxy('notificationapi', targets.notificationapi));
app.use('/faasapi', authMiddleware, serviceProxy('faasapi', targets.faasapi));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'APIGateway' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API Gateway listening on ${PORT}`));
