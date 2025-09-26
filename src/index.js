const { app } = require('./app');
const { WebSocketManager } = require('./websocket');
const { createServer } = require('http');
const { z } = require('zod');

const envSchema = z.object({ 
  PORT: z.string().default('8080'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});
const env = envSchema.parse(process.env);

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket server
const wsManager = new WebSocketManager(server);

// Make WebSocket manager available globally for other parts of the app
global.wsManager = wsManager;

const port = parseInt(env.PORT, 10);
const hostname = env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
server.listen(port, hostname, () => {
  console.log(`Server listening on http://${hostname}:${port}`);
  console.log(`WebSocket server available at ws://${hostname}:${port}/ws`);
});
