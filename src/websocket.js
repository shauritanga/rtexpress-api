const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

class WebSocketManager {
  constructor(server) {
    // Create WebSocket server with explicit configuration to disable compression
    this.wss = new WebSocketServer({
      noServer: true, // Handle upgrade manually
      path: '/ws',
      perMessageDeflate: false,
      // Add options to be more lenient with frame processing
      skipUTF8Validation: true, // Skip UTF-8 validation to avoid issues
    });

    // Handle upgrade requests manually
    server.on('upgrade', (request, socket, head) => {
      console.log('Manual upgrade request for:', request.url);

      // Check if this is our WebSocket path
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/ws') {
        // Verify the client before upgrading
        this.verifyClient({ req: request }, (verified, code, message) => {
          if (verified) {
            console.log('Client verified, upgrading to WebSocket');
            this.wss.handleUpgrade(request, socket, head, (ws) => {
              this.wss.emit('connection', ws, request);
            });
          } else {
            console.log('Client verification failed, rejecting upgrade with code:', code, 'message:', message);
            // Properly reject the WebSocket upgrade request
            if (socket.writable) {
              socket.write(`HTTP/1.1 ${code || 400} ${message || 'Bad Request'}\r\n\r\n`);
            }
            socket.destroy();
          }
        });
      } else {
        // Not our WebSocket path, let other handlers deal with it
        socket.destroy();
      }
    });

    this.clients = new Map();

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', (err) => {
      console.error('WebSocket server error:', err);
    });

    // Log when clients connect and disconnect
    this.wss.on('listening', () => {
      console.log('WebSocket server is listening');
    });

    this.wss.on('headers', (headers, request) => {
      console.log('WebSocket handshake headers:', headers, 'for request:', request.url);
      // Check if compression headers are present
      const hasCompressionHeaders = headers.some(header =>
        header.toLowerCase().includes('sec-websocket-extensions') ||
        header.toLowerCase().includes('permessage-deflate')
      );
      if (hasCompressionHeaders) {
        console.warn('WARNING: Compression headers detected in WebSocket handshake');
      }
    });

    console.log('WebSocket server initialized with manual upgrade handling and lenient frame processing');
  }

  verifyClient(info, callback) {
    console.log('WebSocket connection attempt from:', info.req.headers['user-agent'], info.req.headers['origin']);

    // Log compression-related headers but don't reject the connection
    const extensions = info.req.headers['sec-websocket-extensions'];
    if (extensions) {
      console.log('WebSocket extensions requested:', extensions);
      if (extensions.includes('permessage-deflate')) {
        console.log('INFO: Client requesting permessage-deflate compression - will be disabled by server configuration');
        // Don't reject - let the WebSocket server handle the negotiation
        // The server is configured with perMessageDeflate: false, so compression will be disabled
      }
    }

    const url = new URL(info.req.url, `http://${info.req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      console.log('WebSocket connection rejected: No token provided');
      callback(false, 401, 'Missing token');
      return;
    }

    // Verify JWT access token using same secret as HTTP auth
    const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'your-secret-key';
    try {
      jwt.verify(token, secret);
      console.log('WebSocket connection verified successfully');
      callback(true);
    } catch (error) {
      console.log('WebSocket connection rejected: Invalid token', error);
      callback(false, 401, 'Invalid token');
    }
  }

  handleConnection(ws, req) {
    console.log('WebSocket connection established');

    // Add a flag to track if we've already handled an RSV1 error for this connection
    let rsv1ErrorHandled = false;

    // Log when the connection is established
    const connectionTime = Date.now();
    console.log(`WebSocket connection established at ${new Date().toISOString()}`);

    // Log the first few bytes of any incoming data to debug frame issues
    let firstDataReceived = false;

    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'your-secret-key';
      if (!token) {
        console.log('WebSocket connection rejected: Missing token');
        ws.close(1008, 'Missing token');
        return;
      }
      let decoded;
      try {
        decoded = jwt.verify(token, secret);
      } catch (error) {
        console.log('WebSocket connection rejected: Invalid token', error && error.message ? error.message : error);
        ws.close(1008, 'Invalid token');
        return;
      }
      ws.userId = decoded.sub || decoded.userId || decoded.id;
      ws.userRole = decoded.role || decoded.userRole;

      // Store client connection
      if (ws.userId) {
        this.clients.set(ws.userId, ws);
        console.log(`WebSocket client connected: ${ws.userId} (${ws.userRole}) at ${Date.now() - connectionTime}ms after connection`);
      }

      // Handle incoming messages
      ws.on('message', (data, isBinary) => {
        if (!firstDataReceived) {
          firstDataReceived = true;
          console.log('First message received:', {
            isBinary,
            length: data.length,
            // First few bytes as hex for debugging
            firstBytes: data.slice(0, 10).toString('hex')
          });
        }

        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
          // Don't close the connection for invalid messages, just log the error
        }
      });

      // Handle errors so the process doesn't crash on malformed frames
      ws.on('error', (err) => {
        // Log specific WebSocket frame errors
        if (err.code === 'WS_ERR_UNEXPECTED_RSV_1') {
          if (!rsv1ErrorHandled) {
            rsv1ErrorHandled = true;
            const timeSinceConnection = Date.now() - connectionTime;
            console.error('WebSocket client error: Invalid frame - RSV1 must be clear. This typically indicates a compression mismatch.', {
              code: err.code,
              userId: ws.userId,
              userRole: ws.userRole,
              timeSinceConnectionMs: timeSinceConnection,
              firstDataReceived
            });
            // Close the connection to prevent further errors
            try {
              ws.close(1002, 'Protocol error: Compression mismatch');
            } catch (closeErr) {
              console.error('Error closing WebSocket connection:', closeErr);
            }
          }
        } else {
          console.error('WebSocket client error:', err);
          // Close the connection for other errors as well
          try {
            ws.close(1011, 'Internal server error');
          } catch (closeErr) {
            console.error('Error closing WebSocket connection:', closeErr);
          }
        }
      });

      // Handle disconnection
      ws.on('close', (code, reason) => {
        const timeSinceConnection = Date.now() - connectionTime;
        console.log(`WebSocket client closed: ${ws.userId} with code: ${code} and reason: ${reason} after ${timeSinceConnection}ms`);
        if (ws.userId) {
          this.clients.delete(ws.userId);
          console.log(`WebSocket client disconnected: ${ws.userId}`);
        }
      });

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connection_established',
        message: 'Connected to Ship Master WebSocket server',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('WebSocket connection error:', error);
      ws.close();
    }
  }

  handleMessage(ws, message) {
    try {
      console.log(`Received message from ${ws.userId}:`, message);

      switch (message.type) {
        case 'getUnreadNotifications':
          // Send any pending notifications for this user
          this.sendNotificationHistory(ws);
          break;

        case 'markNotificationRead':
          // Handle marking notification as read
          console.log(`Marking notification ${message.id} as read for user ${ws.userId}`);
          break;

        case 'markAllNotificationsRead':
          // Handle marking all notifications as read
          console.log(`Marking all notifications as read for user ${ws.userId}`);
          break;

        case 'clearNotifications':
          // Handle clearing notifications
          console.log(`Clearing notifications for user ${ws.userId}`);
          break;

        case 'ping':
          this.sendToClient(ws, { type: 'pong', timestamp: new Date().toISOString() });
          break;

        default:
          console.log(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      // Don't close the connection, just log the error
    }
  }

  sendNotificationHistory(ws) {
    // In a real implementation, you'd fetch from database
    // For now, send a sample notification
    this.sendToClient(ws, {
      type: 'notification',
      id: `notif_${Date.now()}`,
      title: 'Welcome Back',
      message: 'You have successfully connected to the notification system',
      timestamp: new Date().toISOString(),
      data: { userId: ws.userId }
    });
  }

  // Public methods for sending notifications
  sendToClient(ws, message) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      // Don't close the connection, just log the error
    }
  }

  sendToUser(userId, message) {
    const client = this.clients.get(userId);
    if (client) {
      this.sendToClient(client, {
        ...message,
        id: message.id || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: message.timestamp || new Date().toISOString()
      });
      return true;
    }
    return false;
  }

  broadcastToRole(role, message) {
    let sentCount = 0;
    this.clients.forEach((client, userId) => {
      if (client.userRole === role) {
        this.sendToClient(client, {
          ...message,
          id: message.id || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: message.timestamp || new Date().toISOString()
        });
        sentCount++;
      }
    });
    return sentCount;
  }

  broadcastToAll(message) {
    let sentCount = 0;
    this.clients.forEach((client) => {
      this.sendToClient(client, {
        ...message,
        id: message.id || `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: message.timestamp || new Date().toISOString()
      });
      sentCount++;
    });
    return sentCount;
  }

  getConnectedClients() {
    const clients = [];
    this.clients.forEach((client, userId) => {
      clients.push({ userId, role: client.userRole || 'unknown' });
    });
    return clients;
  }

  isUserConnected(userId) {
    return this.clients.has(userId);
  }
}

module.exports = { WebSocketManager };
