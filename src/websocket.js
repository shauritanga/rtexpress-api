const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

class WebSocketManager {
  constructor(server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      verifyClient: this.verifyClient.bind(this)
    });
    this.clients = new Map();

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('WebSocket server initialized');
  }

  verifyClient(info) {
    try {
      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token) {
        console.log('WebSocket connection rejected: No token provided');
        return false;
      }

      // Verify JWT access token using same secret as HTTP auth
      const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'your-secret-key';
      jwt.verify(token, secret);
      return true;
    } catch (error) {
      console.log('WebSocket connection rejected: Invalid token', error);
      return false;
    }
  }

  handleConnection(ws, req) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (token) {
        const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'your-secret-key';
        const decoded = jwt.verify(token, secret);
        ws.userId = decoded.sub || decoded.userId || decoded.id;
        ws.userRole = decoded.role || decoded.userRole;

        // Store client connection
        if (ws.userId) {
          this.clients.set(ws.userId, ws);
          console.log(`WebSocket client connected: ${ws.userId} (${ws.userRole})`);
        }
      }

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
        }
      });

      // Handle disconnection
      ws.on('close', () => {
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
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
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
