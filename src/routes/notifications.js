const { Router } = require('express');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

router.use(authenticate);

// Get notifications for current user
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const { page = '1', limit = '20', unreadOnly = 'false' } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const where = { userId: user.sub };
    if (unreadOnly === 'true') {
      where.read = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limitNum,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: { userId: user.sub, read: false }
      }),
    ]);

    res.json({
      notifications,
      unreadCount,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark notification as read
router.patch('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const notification = await prisma.notification.updateMany({
      where: { 
        id,
        userId: user.sub
      },
      data: {
        read: true,
        readAt: new Date()
      }
    });

    if (notification.count === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read' });

  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark notifications as read (batch operation)
router.patch('/mark-read', async (req, res) => {
  try {
    const user = req.user;
    const { notificationIds, markAll } = req.body;

    const where = {
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
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// Mark all notifications as read
router.patch('/read-all', async (req, res) => {
  try {
    const user = req.user;

    await prisma.notification.updateMany({
      where: {
        userId: user.sub,
        read: false
      },
      data: {
        read: true,
        readAt: new Date()
      }
    });

    res.json({ message: 'All notifications marked as read' });

  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete all notifications for user
router.delete('/', async (req, res) => {
  try {
    const user = req.user;

    const deleted = await prisma.notification.deleteMany({
      where: {
        userId: user.sub
      }
    });

    res.json({ deleted: deleted.count });

  } catch (error) {
    console.error('Error deleting all notifications:', error);
    res.status(500).json({ error: 'Failed to delete all notifications' });
  }
});

// Delete notification
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const notification = await prisma.notification.deleteMany({
      where: {
        id,
        userId: user.sub
      }
    });

    if (notification.count === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /notifications/unread-count - Get unread notification count
router.get('/unread-count', async (req, res) => {
  try {
    const user = req.user;

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

// Get notification settings (admin only)
router.get('/settings', requireRole('ADMIN'), async (req, res) => {
  try {
    // Return default notification settings
    res.json({
      emailNotifications: true,
      pushNotifications: true,
      smsNotifications: false,
      categories: {
        shipment: true,
        invoice: true,
        payment: true,
        support: true,
        system: true,
      }
    });
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router };
