const { app } = require('./app');
const { createServer } = require('http');
const { WebSocketManager } = require('./websocket/WebSocketManager');
const { z } = require('zod');

// Read environment with sane defaults for shared hosting
const envSchema = z.object({
  PORT: z.string().default('8080'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  WS_PATH: z.string().default('/ws')
});
const env = envSchema.parse(process.env);

// Create a single HTTP server to serve both API and WebSocket (same port)
const server = createServer(app);

// Attach WebSocket manager to the same HTTP server (Upgrade on path)
const wsManager = new WebSocketManager(server, { path: env.WS_PATH });
// Make available globally if other modules want to publish events
global.wsManager = wsManager;

// Start HTTP+WS server
const port = parseInt(env.PORT, 10);
server.listen(port, () => {
  const hostForLog = env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  console.log(`🚀 HTTP API + WebSocket listening on http://${hostForLog}:${port}`);
  console.log(`🔌 WebSocket Upgrade path: ${env.WS_PATH}`);
  console.log(`✅ RT Express server started successfully`);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ HTTP server closed');
  });
});

process.on('SIGINT', async () => {
  console.log('🔄 Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('✅ HTTP server closed');
  });
});