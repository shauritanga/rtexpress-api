import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { hasPermission } from '../lib/permissions';
import { NotificationService } from '../services/notificationService';

const router = Router();

// Apply auth middleware to all routes
router.use(authenticate);

// Validation schemas
const createNotificationSchema = z.object({
  userId: z.string(),
  type: z.enum(['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'SHIPMENT_UPDATE', 'INVOICE_UPDATE', 'PAYMENT_UPDATE', 'SUPPORT_UPDATE', 'BOOKING_UPDATE', 'SYSTEM_ALERT', 'PROMOTIONAL']),
  title: z.string().min(1).max(255),
  message: z.string().min(1),
  data: z.any().optional(),
  actionUrl: z.string().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  category: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

const markAsReadSchema = z.object({
  notificationIds: z.array(z.string()).optional(),
  markAll: z.boolean().optional(),
});

const notificationFiltersSchema = z.object({
  read: z.boolean().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
  priority: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

// GET /notifications - Get user's notifications
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    const filters = notificationFiltersSchema.parse(req.query);

    const where: any = {
      userId: user.sub,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    };

    if (filters.read !== undefined) {
      where.read = filters.read;
    }
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.category) {
      where.category = filters.category;
    }
    if (filters.priority) {
      where.priority = filters.priority;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' }
        ],
        take: filters.limit,
        skip: filters.offset,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          userId: user.sub,
          read: false,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        }
      })
    ]);

    res.json({
      notifications,
      total,
      unreadCount,
      hasMore: total > filters.offset + filters.limit
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// GET /notifications/unread-count - Get unread notification count
router.get('/unread-count', async (req, res) => {
  try {
    const user = (req as any).user;
    
    const unreadCount = await prisma.notification.count({
      where: {
        userId: user.sub,
        read: false,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      }
    });

    res.json({ unreadCount });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// POST /notifications - Create notification (admin only)
router.post('/', async (req, res) => {
  try {
    const user = (req as any).user;
    
    // Check if user has permission to create notifications
    const canCreate = await hasPermission(user.sub, 'notifications:create');
    if (!canCreate) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const data = createNotificationSchema.parse(req.body);
    
    const notification = await prisma.notification.create({
      data: {
        ...data,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      }
    });

    // Send real-time notification via WebSocket
    if (global.wsManager) {
      global.wsManager.sendToUser(data.userId, {
        type: data.type.toLowerCase() as any,
        title: data.title,
        message: data.message,
        data: { ...data.data, notificationId: notification.id }
      });
    }

    res.status(201).json(notification);
  } catch (error) {
    console.error('Error creating notification:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// PATCH /notifications/mark-read - Mark notifications as read
router.patch('/mark-read', async (req, res) => {
  try {
    const user = (req as any).user;
    const { notificationIds, markAll } = markAsReadSchema.parse(req.body);

    const where: any = {
      userId: user.sub,
      read: false
    };

    if (!markAll && notificationIds && notificationIds.length > 0) {
      where.id = { in: notificationIds };
    }

    const updated = await prisma.notification.updateMany({
      where,
      data: {
        read: true,
        readAt: new Date()
      }
    });

    res.json({ updated: updated.count });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid data', details: error.errors });
    }
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// DELETE /notifications/:id - Delete notification
router.delete('/:id', async (req, res) => {
  try {
    const user = (req as any).user;
    const { id } = req.params;

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        userId: user.sub
      }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await prisma.notification.delete({
      where: { id }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// DELETE /notifications - Delete all notifications for user
router.delete('/', async (req, res) => {
  try {
    const user = (req as any).user;

    const deleted = await prisma.notification.deleteMany({
      where: {
        userId: user.sub
      }
    });

    res.json({ deleted: deleted.count });
  } catch (error) {
    console.error('Error deleting notifications:', error);
    res.status(500).json({ error: 'Failed to delete notifications' });
  }
});

export { router };
