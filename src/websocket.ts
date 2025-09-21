import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  userRole?: string;
}

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

interface NotificationMessage {
  type: 'notification' | 'info' | 'success' | 'warning' | 'error';
  id?: string;
  title?: string;
  message: string;
  timestamp?: string;
  data?: any;
}

class WebSocketManager {
  private wss: WebSocketServer;
  private clients: Map<string, AuthenticatedWebSocket> = new Map();

  constructor(server: any) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      verifyClient: this.verifyClient.bind(this)
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('WebSocket server initialized');
  }

  private verifyClient(info: { req: IncomingMessage }): boolean {
    try {
      const url = new URL(info.req.url!, `http://${info.req.headers.host}`);
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

  private handleConnection(ws: AuthenticatedWebSocket, req: IncomingMessage) {
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (token) {
        const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'your-secret-key';
        const decoded = jwt.verify(token, secret) as any;
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
          const message: WebSocketMessage = JSON.parse(data.toString());
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

  private handleMessage(ws: AuthenticatedWebSocket, message: WebSocketMessage) {
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

  private sendNotificationHistory(ws: AuthenticatedWebSocket) {
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
  public sendToClient(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  public sendToUser(userId: string, message: NotificationMessage) {
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

  public broadcastToRole(role: string, message: NotificationMessage) {
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

  public broadcastToAll(message: NotificationMessage) {
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

  public getConnectedClients(): { userId: string; role: string }[] {
    const clients: { userId: string; role: string }[] = [];
    this.clients.forEach((client, userId) => {
      clients.push({ userId, role: client.userRole || 'unknown' });
    });
    return clients;
  }

  public isUserConnected(userId: string): boolean {
    return this.clients.has(userId);
  }
}

export { WebSocketManager, NotificationMessage };