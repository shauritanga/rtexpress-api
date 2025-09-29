const { app } = require('./app');
const { wsServer } = require('./websocket/server');
const { createServer } = require('http');
const { z } = require('zod');

const envSchema = z.object({
  PORT: z.string().default('8080'),
  WS_PORT: z.string().default('8081'),
  WS_HOST: z.string().default('::'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});
const env = envSchema.parse(process.env);

// Create HTTP server for API only
const server = createServer(app);

// Start dedicated WebSocket server on separate port
async function startServers() {
  try {
    // Configure WebSocket server
    wsServer.options.port = parseInt(env.WS_PORT, 10);
    wsServer.options.host = env.WS_HOST;

    // Start WebSocket server
    const wsManager = await wsServer.start();

    // Make WebSocket manager available globally for other parts of the app
    global.wsManager = wsManager;
    global.wsServer = wsServer;

    // Start HTTP API server
    const port = parseInt(env.PORT, 10);
    server.listen(port, '::', () => {
      const hostForLog = env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
      console.log(`🚀 HTTP API server listening on http://${hostForLog}:${port}`);
      console.log(`🔌 WebSocket server running on ws://${hostForLog}:${env.WS_PORT}/ws`);
      console.log(`📊 WebSocket metrics: http://${hostForLog}:${env.WS_PORT}/metrics`);
      console.log(`✅ RT Express servers started successfully`);
    });

  } catch (error) {
    console.error('❌ Failed to start servers:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Received SIGTERM, shutting down gracefully...');

  // Close HTTP server
  server.close(() => {
    console.log('✅ HTTP server closed');
  });

  // WebSocket server will handle its own shutdown
});

process.on('SIGINT', async () => {
  console.log('🔄 Received SIGINT, shutting down gracefully...');

  // Close HTTP server
  server.close(() => {
    console.log('✅ HTTP server closed');
  });

  // WebSocket server will handle its own shutdown
});

// Start all servers
startServers();