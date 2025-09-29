const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const EventEmitter = require('events');

/**
 * Professional WebSocket Manager with production-ready features:
 * - Proper connection lifecycle management
 * - Token refresh support
 * - Rate limiting and connection limits
 * - Health monitoring and metrics
 * - Graceful error handling
 */
class WebSocketManager extends EventEmitter {
  constructor(server, options = {}) {
    super();
    
    this.options = {
      maxConnections: options.maxConnections || 1000,
      heartbeatInterval: options.heartbeatInterval || 30000,
      tokenRefreshThreshold: options.tokenRefreshThreshold || 300000, // 5 minutes
      connectionTimeout: options.connectionTimeout || 10000,
      maxMessageSize: options.maxMessageSize || 1024 * 1024, // 1MB
      rateLimitWindow: options.rateLimitWindow || 60000, // 1 minute
      rateLimitMax: options.rateLimitMax || 100, // messages per window
      ...options
    };

    // Connection tracking
    this.clients = new Map(); // userId -> WebSocket
    this.connectionMetrics = {
      totalConnections: 0,
      activeConnections: 0,
      rejectedConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0
    };

    // Rate limiting
    this.rateLimitMap = new Map(); // userId -> { count, resetTime }

    this.initializeWebSocketServer(server);
    this.startHealthMonitoring();
  }

  initializeWebSocketServer(server) {
    // Create WebSocket server with optimized configuration
    this.wss = new WebSocketServer({
      noServer: true,
      path: '/ws',
      perMessageDeflate: {
        // Enable compression but with safe defaults
        threshold: 1024,
        concurrencyLimit: 10,
        memLevel: 7,
        serverMaxWindowBits: 15,
        clientMaxWindowBits: 15,
      },
      maxPayload: this.options.maxMessageSize,
      skipUTF8Validation: false, // Keep validation for security
    });

    // Handle upgrade requests with proper validation
    server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleServerError.bind(this));

    console.log('✅ Professional WebSocket server initialized');
  }

  async handleUpgrade(request, socket, head) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      
      // Only handle our WebSocket path
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }

      // Check connection limits
      if (this.connectionMetrics.activeConnections >= this.options.maxConnections) {
        this.rejectConnection(socket, 503, 'Server at capacity');
        return;
      }

      // Verify client with enhanced validation
      const verification = await this.verifyClient(request);
      
      if (verification.success) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          ws.userId = verification.userId;
          ws.userRole = verification.userRole;
          ws.tokenExp = verification.tokenExp;
          this.wss.emit('connection', ws, request);
        });
      } else {
        this.rejectConnection(socket, verification.code, verification.message);
      }
    } catch (error) {
      console.error('❌ WebSocket upgrade error:', error);
      this.connectionMetrics.errors++;
      socket.destroy();
    }
  }

  handleServerError(error) {
    console.error('❌ WebSocket server error:', error);
    this.connectionMetrics.errors++;
    this.emit('error', error);
  }

  async verifyClient(request) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        return { success: false, code: 401, message: 'Missing authentication token' };
      }

      // Verify JWT token
      const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'your-secret-key';
      const decoded = jwt.verify(token, secret);
      
      const userId = decoded.sub || decoded.userId || decoded.id;
      const userRole = decoded.role || decoded.userRole;
      const tokenExp = decoded.exp;

      // Check if token is expiring soon
      const now = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = (tokenExp - now) * 1000;
      
      if (timeUntilExpiry < 0) {
        return { success: false, code: 401, message: 'Token expired' };
      }

      // Check rate limiting
      if (!this.checkRateLimit(userId)) {
        return { success: false, code: 429, message: 'Rate limit exceeded' };
      }

      return {
        success: true,
        userId,
        userRole,
        tokenExp,
        timeUntilExpiry
      };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return { success: false, code: 401, message: 'Token expired' };
      } else if (error.name === 'JsonWebTokenError') {
        return { success: false, code: 401, message: 'Invalid token' };
      }
      
      console.error('❌ Token verification error:', error);
      return { success: false, code: 500, message: 'Authentication error' };
    }
  }

  checkRateLimit(userId) {
    const now = Date.now();
    const userLimit = this.rateLimitMap.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      // Reset or initialize rate limit
      this.rateLimitMap.set(userId, {
        count: 1,
        resetTime: now + this.options.rateLimitWindow
      });
      return true;
    }

    if (userLimit.count >= this.options.rateLimitMax) {
      return false;
    }

    userLimit.count++;
    return true;
  }

  rejectConnection(socket, code, message) {
    console.log(`🚫 WebSocket connection rejected: ${code} - ${message}`);
    this.connectionMetrics.rejectedConnections++;
    
    if (socket.writable) {
      socket.write(`HTTP/1.1 ${code} ${message}\r\n\r\n`);
    }
    socket.destroy();
  }

  handleConnection(ws, request) {
    try {
      this.connectionMetrics.totalConnections++;
      this.connectionMetrics.activeConnections++;

      console.log(`✅ WebSocket connected: ${ws.userId} (${ws.userRole})`);

      // Store connection
      this.clients.set(ws.userId, ws);

      // Set up connection properties
      ws.isAlive = true;
      ws.lastActivity = Date.now();
      ws.messageCount = 0;

      // Set up event handlers
      this.setupConnectionHandlers(ws);

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connection_established',
        message: 'Connected to RT Express WebSocket server',
        timestamp: new Date().toISOString(),
        serverTime: Date.now()
      });

      // Schedule token refresh check
      this.scheduleTokenRefreshCheck(ws);

      this.emit('connection', ws);
    } catch (error) {
      console.error('❌ Connection setup error:', error);
      this.connectionMetrics.errors++;
      ws.close(1011, 'Internal server error');
    }
  }

  setupConnectionHandlers(ws) {
    // Heartbeat handler
    ws.on('pong', () => {
      ws.isAlive = true;
      ws.lastActivity = Date.now();
    });

    // Message handler with rate limiting
    ws.on('message', (data, isBinary) => {
      try {
        ws.lastActivity = Date.now();
        ws.messageCount++;
        this.connectionMetrics.messagesReceived++;

        // Check message rate limiting
        if (!this.checkRateLimit(ws.userId)) {
          this.sendToClient(ws, {
            type: 'error',
            message: 'Rate limit exceeded',
            code: 'RATE_LIMIT_EXCEEDED'
          });
          return;
        }

        if (!isBinary) {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        }
      } catch (error) {
        console.error('❌ Message handling error:', error);
        this.connectionMetrics.errors++;
        this.sendToClient(ws, {
          type: 'error',
          message: 'Invalid message format',
          code: 'INVALID_MESSAGE'
        });
      }
    });

    // Error handler
    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for user ${ws.userId}:`, error);
      this.connectionMetrics.errors++;
    });

    // Close handler
    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket disconnected: ${ws.userId} (${code}: ${reason})`);
      this.connectionMetrics.activeConnections--;
      this.clients.delete(ws.userId);
      this.emit('disconnect', ws, code, reason);
    });
  }

  scheduleTokenRefreshCheck(ws) {
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = (ws.tokenExp - now) * 1000;
    const refreshTime = timeUntilExpiry - this.options.tokenRefreshThreshold;

    if (refreshTime > 0) {
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this.sendToClient(ws, {
            type: 'token_refresh_required',
            message: 'Please refresh your authentication token',
            expiresIn: this.options.tokenRefreshThreshold
          });
        }
      }, refreshTime);
    }
  }

  handleMessage(ws, message) {
    try {
      switch (message.type) {
        case 'ping':
          this.sendToClient(ws, { 
            type: 'pong', 
            timestamp: new Date().toISOString(),
            serverTime: Date.now()
          });
          break;

        case 'token_refresh':
          this.handleTokenRefresh(ws, message.token);
          break;

        case 'get_notifications':
          this.handleGetNotifications(ws);
          break;

        case 'mark_notification_read':
          this.handleMarkNotificationRead(ws, message.notificationId);
          break;

        case 'mark_all_notifications_read':
          this.handleMarkAllNotificationsRead(ws);
          break;

        default:
          this.emit('message', ws, message);
      }
    } catch (error) {
      console.error('❌ Message processing error:', error);
      this.connectionMetrics.errors++;
    }
  }

  async handleTokenRefresh(ws, newToken) {
    try {
      const verification = await this.verifyClient({
        url: `/ws?token=${newToken}`,
        headers: { host: 'localhost' }
      });

      if (verification.success && verification.userId === ws.userId) {
        ws.tokenExp = verification.tokenExp;
        this.scheduleTokenRefreshCheck(ws);

        this.sendToClient(ws, {
          type: 'token_refreshed',
          message: 'Token successfully refreshed'
        });
      } else {
        this.sendToClient(ws, {
          type: 'token_refresh_failed',
          message: 'Invalid token provided'
        });
      }
    } catch (error) {
      console.error('❌ Token refresh error:', error);
      this.sendToClient(ws, {
        type: 'token_refresh_failed',
        message: 'Token refresh failed'
      });
    }
  }

  handleGetNotifications(ws) {
    // Placeholder for notification retrieval
    this.sendToClient(ws, {
      type: 'notifications',
      data: [],
      timestamp: new Date().toISOString()
    });
  }

  handleMarkNotificationRead(ws, notificationId) {
    // Placeholder for marking notification as read
    this.sendToClient(ws, {
      type: 'notification_marked_read',
      notificationId,
      timestamp: new Date().toISOString()
    });
  }

  handleMarkAllNotificationsRead(ws) {
    // Placeholder for marking all notifications as read
    this.sendToClient(ws, {
      type: 'all_notifications_marked_read',
      timestamp: new Date().toISOString()
    });
  }

  // Public API methods
  sendToClient(ws, message) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify({
          ...message,
          id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: message.timestamp || new Date().toISOString()
        });

        ws.send(payload);
        this.connectionMetrics.messagesSent++;
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error sending message:', error);
      this.connectionMetrics.errors++;
      return false;
    }
  }

  sendToUser(userId, message) {
    const client = this.clients.get(userId);
    if (client) {
      return this.sendToClient(client, message);
    }
    return false;
  }

  broadcastToRole(role, message) {
    let sentCount = 0;
    this.clients.forEach((client) => {
      if (client.userRole === role) {
        if (this.sendToClient(client, message)) {
          sentCount++;
        }
      }
    });
    return sentCount;
  }

  broadcastToAll(message) {
    let sentCount = 0;
    this.clients.forEach((client) => {
      if (this.sendToClient(client, message)) {
        sentCount++;
      }
    });
    return sentCount;
  }

  // Health monitoring and maintenance
  startHealthMonitoring() {
    // Heartbeat check every 30 seconds
    setInterval(() => {
      this.performHeartbeatCheck();
    }, this.options.heartbeatInterval);

    // Cleanup stale connections every 5 minutes
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 300000);

    // Rate limit cleanup every minute
    setInterval(() => {
      this.cleanupRateLimits();
    }, 60000);

    console.log('✅ Health monitoring started');
  }

  performHeartbeatCheck() {
    const now = Date.now();
    let staleConnections = 0;

    this.clients.forEach((client, userId) => {
      if (client.readyState === WebSocket.OPEN) {
        if (client.isAlive === false) {
          console.log(`💔 Terminating stale connection: ${userId}`);
          client.terminate();
          staleConnections++;
        } else {
          client.isAlive = false;
          client.ping();
        }
      } else {
        this.clients.delete(userId);
      }
    });

    if (staleConnections > 0) {
      console.log(`🧹 Cleaned up ${staleConnections} stale connections`);
    }
  }

  cleanupStaleConnections() {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes
    let cleanedUp = 0;

    this.clients.forEach((client, userId) => {
      if (now - client.lastActivity > staleThreshold) {
        console.log(`🧹 Cleaning up inactive connection: ${userId}`);
        client.close(1000, 'Inactive connection');
        cleanedUp++;
      }
    });

    if (cleanedUp > 0) {
      console.log(`🧹 Cleaned up ${cleanedUp} inactive connections`);
    }
  }

  cleanupRateLimits() {
    const now = Date.now();
    let cleanedUp = 0;

    this.rateLimitMap.forEach((limit, userId) => {
      if (now > limit.resetTime) {
        this.rateLimitMap.delete(userId);
        cleanedUp++;
      }
    });

    if (cleanedUp > 0) {
      console.log(`🧹 Cleaned up ${cleanedUp} expired rate limits`);
    }
  }

  // Metrics and monitoring
  getMetrics() {
    return {
      ...this.connectionMetrics,
      connectedUsers: this.clients.size,
      rateLimitEntries: this.rateLimitMap.size,
      uptime: process.uptime()
    };
  }

  getConnectedUsers() {
    const users = [];
    this.clients.forEach((client, userId) => {
      users.push({
        userId,
        role: client.userRole,
        connected: new Date(client.lastActivity).toISOString(),
        messageCount: client.messageCount
      });
    });
    return users;
  }

  // Graceful shutdown
  async shutdown() {
    console.log('🔄 Shutting down WebSocket server...');

    // Notify all clients
    this.broadcastToAll({
      type: 'server_shutdown',
      message: 'Server is shutting down. Please reconnect in a moment.',
      timestamp: new Date().toISOString()
    });

    // Close all connections gracefully
    const closePromises = [];
    this.clients.forEach((client) => {
      closePromises.push(new Promise((resolve) => {
        client.close(1001, 'Server shutdown');
        client.on('close', resolve);
      }));
    });

    await Promise.all(closePromises);
    this.wss.close();
    console.log('✅ WebSocket server shutdown complete');
  }
}

module.exports = { WebSocketManager };
