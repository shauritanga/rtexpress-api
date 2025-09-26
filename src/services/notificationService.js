const { prisma } = require('../lib/prisma');

class NotificationService {
  /**
   * Create a persistent notification and send real-time notification
   */
  static async createNotification(data) {
    try {
      // Create persistent notification in database
      const notification = await prisma.notification.create({
        data: {
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message,
          data: data.data || null,
          actionUrl: data.actionUrl || null,
          priority: data.priority || 'NORMAL',
          category: data.category || null,
          expiresAt: data.expiresAt || null,
        }
      });

      // Send real-time notification via WebSocket
      if (global.wsManager) {
        const wsMessage = {
          type: data.type.toLowerCase(),
          title: data.title,
          message: data.message,
          data: { 
            ...data.data, 
            notificationId: notification.id,
            actionUrl: data.actionUrl,
            priority: data.priority,
            category: data.category
          }
        };

        global.wsManager.sendToUser(data.userId, wsMessage);
      }

      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Send shipment update notification
   */
  static async sendShipmentNotification(userId, trackingNumber, status, shipmentId) {
    const statusMessages = {
      'PENDING': 'Your shipment has been received and is being processed',
      'PICKED_UP': 'Your shipment has been picked up',
      'IN_TRANSIT': 'Your shipment is in transit',
      'OUT_FOR_DELIVERY': 'Your shipment is out for delivery',
      'DELIVERED': 'Your shipment has been delivered',
      'RETURNED': 'Your shipment has been returned',
      'CANCELLED': 'Your shipment has been cancelled'
    };

    return this.createNotification({
      userId,
      type: 'SHIPMENT_UPDATE',
      title: `Shipment Update - ${trackingNumber}`,
      message: statusMessages[status] || `Shipment status updated to ${status}`,
      data: { shipmentId, trackingNumber, status },
      actionUrl: shipmentId ? `/shipments/${shipmentId}` : `/shipments?search=${trackingNumber}`,
      priority: status === 'DELIVERED' ? 'HIGH' : 'NORMAL',
      category: 'shipment'
    });
  }

  /**
   * Send invoice notification
   */
  static async sendInvoiceNotification(userId, invoiceNumber, action, invoiceId) {
    const actionMessages = {
      'created': 'A new invoice has been generated',
      'sent': 'Your invoice has been sent',
      'paid': 'Your invoice has been paid',
      'overdue': 'Your invoice is overdue',
      'cancelled': 'Your invoice has been cancelled'
    };

    return this.createNotification({
      userId,
      type: 'INVOICE_UPDATE',
      title: `Invoice ${action.charAt(0).toUpperCase() + action.slice(1)} - ${invoiceNumber}`,
      message: actionMessages[action] || `Invoice ${action}`,
      data: { invoiceId, invoiceNumber, action },
      actionUrl: invoiceId ? `/invoices/${invoiceId}` : `/invoices?search=${invoiceNumber}`,
      priority: action === 'overdue' ? 'HIGH' : 'NORMAL',
      category: 'invoice'
    });
  }

  /**
   * Send payment notification
   */
  static async sendPaymentNotification(userId, amount, status, invoiceNumber, paymentId) {
    const statusMessages = {
      'pending': 'Your payment is being processed',
      'completed': `Payment of ${amount} has been completed`,
      'failed': 'Your payment has failed',
      'refunded': `Payment of ${amount} has been refunded`
    };

    return this.createNotification({
      userId,
      type: 'PAYMENT_UPDATE',
      title: `Payment ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: statusMessages[status] || `Payment status: ${status}`,
      data: { paymentId, amount, status, invoiceNumber },
      actionUrl: paymentId ? `/payments/${paymentId}` : '/payments',
      priority: status === 'failed' ? 'HIGH' : 'NORMAL',
      category: 'payment'
    });
  }

  /**
   * Send support ticket notification
   */
  static async sendSupportNotification(userId, ticketId, action, subject) {
    const actionMessages = {
      'created': 'Your support ticket has been created',
      'updated': 'Your support ticket has been updated',
      'replied': 'You have received a reply to your support ticket',
      'resolved': 'Your support ticket has been resolved',
      'closed': 'Your support ticket has been closed'
    };

    return this.createNotification({
      userId,
      type: 'SUPPORT_UPDATE',
      title: `Support Ticket ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      message: subject ? `${actionMessages[action]}: ${subject}` : actionMessages[action],
      data: { ticketId, action, subject },
      actionUrl: `/support/${ticketId}`,
      priority: action === 'replied' ? 'HIGH' : 'NORMAL',
      category: 'support'
    });
  }

  /**
   * Send booking notification
   */
  static async sendBookingNotification(userId, bookingId, action) {
    const actionMessages = {
      'created': 'Your booking request has been submitted',
      'confirmed': 'Your booking has been confirmed',
      'cancelled': 'Your booking has been cancelled',
      'updated': 'Your booking has been updated'
    };

    return this.createNotification({
      userId,
      type: 'BOOKING_UPDATE',
      title: `Booking ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      message: actionMessages[action] || `Booking ${action}`,
      data: { bookingId, action },
      actionUrl: `/bookings/${bookingId}`,
      priority: 'NORMAL',
      category: 'booking'
    });
  }

  /**
   * Send system notification to all users
   */
  static async sendSystemNotification(message, type = 'INFO') {
    try {
      // Get all active users
      const users = await prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true }
      });

      // Create notifications for all users
      const notifications = await Promise.all(
        users.map(user => this.createNotification({
          userId: user.id,
          type: 'SYSTEM_ALERT',
          title: 'System Notification',
          message,
          priority: type === 'ERROR' ? 'URGENT' : type === 'WARNING' ? 'HIGH' : 'NORMAL',
          category: 'system'
        }))
      );

      // Also broadcast via WebSocket
      if (global.wsManager) {
        global.wsManager.broadcastToAll({
          type: type.toLowerCase(),
          title: 'System Notification',
          message,
          data: { category: 'system' }
        });
      }

      return notifications;
    } catch (error) {
      console.error('Error sending system notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to all admin users
   */
  static async sendAdminNotification(message, type = 'INFO') {
    try {
      // Get all admin users
      const adminUsers = await prisma.user.findMany({
        where: { 
          status: 'ACTIVE',
          role: { name: { in: ['ADMIN', 'STAFF'] } }
        },
        select: { id: true }
      });

      // Create notifications for admin users
      const notifications = await Promise.all(
        adminUsers.map(user => this.createNotification({
          userId: user.id,
          type: 'SYSTEM_ALERT',
          title: 'Admin Notification',
          message,
          priority: type === 'ERROR' ? 'URGENT' : type === 'WARNING' ? 'HIGH' : 'NORMAL',
          category: 'admin'
        }))
      );

      // Also broadcast via WebSocket to admin role
      if (global.wsManager) {
        global.wsManager.broadcastToRole('ADMIN', {
          type: type.toLowerCase(),
          title: 'Admin Notification',
          message,
          data: { category: 'admin' }
        });
        global.wsManager.broadcastToRole('STAFF', {
          type: type.toLowerCase(),
          title: 'Admin Notification',
          message,
          data: { category: 'admin' }
        });
      }

      return notifications;
    } catch (error) {
      console.error('Error sending admin notification:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId, userId) {
    return prisma.notification.updateMany({
      where: { 
        id: notificationId,
        userId: userId
      },
      data: { 
        isRead: true,
        readAt: new Date()
      }
    });
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId) {
    return prisma.notification.updateMany({
      where: { 
        userId: userId,
        isRead: false
      },
      data: { 
        isRead: true,
        readAt: new Date()
      }
    });
  }

  /**
   * Get notifications for a user
   */
  static async getUserNotifications(userId, options = {}) {
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const offset = (page - 1) * limit;

    const where = { userId };
    if (unreadOnly) {
      where.isRead = false;
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.notification.count({ where })
    ]);

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Delete old notifications
   */
  static async cleanupOldNotifications(daysOld = 30) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    
    return prisma.notification.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        isRead: true
      }
    });
  }
}

module.exports = { NotificationService };
