const { createServer } = require('http');
const { WebSocketManager } = require('./WebSocketManager');

/**
 * Dedicated WebSocket server running on separate port
 * This prevents WebSocket traffic from interfering with HTTP API performance
 */
class WebSocketServer {
  constructor(options = {}) {
    this.options = {
      port: options.port || 8081,
      host: options.host || '0.0.0.0',
      ...options
    };

    this.server = null;
    this.wsManager = null;
  }

  async start() {
    try {
      // Create dedicated HTTP server for WebSocket
      this.server = createServer();
      
      // Initialize WebSocket manager
      this.wsManager = new WebSocketManager(this.server, this.options);

      // Set up server event handlers
      this.setupServerHandlers();

      // Start listening
      await new Promise((resolve, reject) => {
        this.server.listen(this.options.port, this.options.host, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      const hostForLog = this.options.host === '0.0.0.0' ? 'localhost' : this.options.host;
      console.log(`🚀 WebSocket server listening on ws://${hostForLog}:${this.options.port}/ws`);
      console.log(`📊 WebSocket metrics available at http://${hostForLog}:${this.options.port}/metrics`);

      return this.wsManager;
    } catch (error) {
      console.error('❌ Failed to start WebSocket server:', error);
      throw error;
    }
  }

  setupServerHandlers() {
    // Handle HTTP requests for health checks and metrics
    this.server.on('request', (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      switch (url.pathname) {
        case '/health':
          this.handleHealthCheck(req, res);
          break;
        case '/metrics':
          this.handleMetrics(req, res);
          break;
        case '/users':
          this.handleConnectedUsers(req, res);
          break;
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    // Handle server errors
    this.server.on('error', (error) => {
      console.error('❌ WebSocket server error:', error);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  handleHealthCheck(req, res) {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      connections: this.wsManager ? this.wsManager.clients.size : 0
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  }

  handleMetrics(req, res) {
    if (!this.wsManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'WebSocket manager not initialized' }));
      return;
    }

    const metrics = this.wsManager.getMetrics();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics, null, 2));
  }

  handleConnectedUsers(req, res) {
    if (!this.wsManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'WebSocket manager not initialized' }));
      return;
    }

    const users = this.wsManager.getConnectedUsers();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ users, count: users.length }, null, 2));
  }

  async shutdown() {
    console.log('🔄 Shutting down WebSocket server...');
    
    try {
      if (this.wsManager) {
        await this.wsManager.shutdown();
      }

      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(resolve);
        });
      }

      console.log('✅ WebSocket server shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }

  // Public API for integration with main application
  getManager() {
    return this.wsManager;
  }

  sendToUser(userId, message) {
    return this.wsManager ? this.wsManager.sendToUser(userId, message) : false;
  }

  broadcastToRole(role, message) {
    return this.wsManager ? this.wsManager.broadcastToRole(role, message) : 0;
  }

  broadcastToAll(message) {
    return this.wsManager ? this.wsManager.broadcastToAll(message) : 0;
  }

  isUserConnected(userId) {
    return this.wsManager ? this.wsManager.clients.has(userId) : false;
  }

  getConnectedUserCount() {
    return this.wsManager ? this.wsManager.clients.size : 0;
  }
}

// Export both the class and a singleton instance
const wsServer = new WebSocketServer();

module.exports = { 
  WebSocketServer, 
  wsServer,
  // Legacy compatibility
  WebSocketManager: require('./WebSocketManager').WebSocketManager
};

// If this file is run directly, start the server
if (require.main === module) {
  const port = process.env.WS_PORT || 8081;
  const host = process.env.WS_HOST || '0.0.0.0';
  
  wsServer.options.port = port;
  wsServer.options.host = host;
  
  wsServer.start().catch((error) => {
    console.error('❌ Failed to start WebSocket server:', error);
    process.exit(1);
  });
}
