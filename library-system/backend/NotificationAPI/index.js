const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const amqp = require('amqplib');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let channel;
const connectedClients = new Set();

async function initRabbitMQ() {
  try {
    const conn = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq');
    channel = await conn.createChannel();
    
    const exchange = 'library.events';
    await channel.assertExchange(exchange, 'topic', { durable: true });
    
    const q = await channel.assertQueue('notification-service', { durable: true });
    await channel.bindQueue(q.queue, exchange, 'book.*');
    
    await channel.consume(q.queue, (msg) => {
      if (msg) {
        const event = JSON.parse(msg.content.toString());
        console.log('NotificationAPI: received event:', event);
        
        // Broadcast to all connected WebSocket clients
        connectedClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: event.event,
              data: event,
              timestamp: new Date().toISOString()
            }));
          }
        });
        
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

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'NotificationAPI' }));

wss.on('connection', (ws) => {
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
