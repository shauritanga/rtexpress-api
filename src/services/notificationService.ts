import { prisma } from '../lib/prisma';
import { NotificationMessage } from '../websocket';

export interface CreateNotificationData {
  userId: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'SHIPMENT_UPDATE' | 'INVOICE_UPDATE' | 'PAYMENT_UPDATE' | 'SUPPORT_UPDATE' | 'BOOKING_UPDATE' | 'SYSTEM_ALERT' | 'PROMOTIONAL';
  title: string;
  message: string;
  data?: any;
  actionUrl?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  category?: string;
  expiresAt?: Date;
}

export class NotificationService {
  /**
   * Create a persistent notification and send real-time notification
   */
  static async createNotification(data: CreateNotificationData): Promise<any> {
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
        const wsMessage: NotificationMessage = {
          type: data.type.toLowerCase() as any,
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
   * Create notifications for multiple users
   */
  static async createBulkNotifications(notifications: CreateNotificationData[]): Promise<any[]> {
    try {
      const results = await Promise.all(
        notifications.map(notif => this.createNotification(notif))
      );
      return results;
    } catch (error) {
      console.error('Error creating bulk notifications:', error);
      throw error;
    }
  }

  /**
   * Send shipment update notification
   */
  static async sendShipmentNotification(userId: string, trackingNumber: string, status: string, shipmentId?: string) {
    return this.createNotification({
      userId,
      type: 'SHIPMENT_UPDATE',
      title: 'Shipment Update',
      message: `Your shipment ${trackingNumber} is now ${status}`,
      data: {
        trackingNumber,
        status,
        shipmentId,
        type: 'shipment_update'
      },
      actionUrl: shipmentId ? `/shipments/${shipmentId}` : `/track/${trackingNumber}`,
      category: 'shipment',
      priority: status === 'delivered' ? 'HIGH' : 'NORMAL'
    });
  }

  /**
   * Send invoice notification
   */
  static async sendInvoiceNotification(userId: string, invoiceNumber: string, action: string, invoiceId?: string) {
    const priority = action === 'overdue' ? 'HIGH' : action === 'due_soon' ? 'NORMAL' : 'LOW';
    const type = action === 'paid' ? 'SUCCESS' : 'INVOICE_UPDATE';
    
    return this.createNotification({
      userId,
      type,
      title: 'Invoice Update',
      message: `Invoice ${invoiceNumber} has been ${action}`,
      data: {
        invoiceNumber,
        action,
        invoiceId,
        type: 'invoice_update'
      },
      actionUrl: invoiceId ? `/invoices/${invoiceId}` : `/invoices`,
      category: 'invoice',
      priority
    });
  }

  /**
   * Send payment notification
   */
  static async sendPaymentNotification(userId: string, amount: number, status: string, invoiceNumber?: string, paymentId?: string) {
    const type = status === 'completed' ? 'SUCCESS' : status === 'failed' ? 'ERROR' : 'PAYMENT_UPDATE';
    
    return this.createNotification({
      userId,
      type,
      title: 'Payment Update',
      message: `Payment of $${amount} ${status}${invoiceNumber ? ` for invoice ${invoiceNumber}` : ''}`,
      data: {
        amount,
        status,
        invoiceNumber,
        paymentId,
        type: 'payment_update'
      },
      actionUrl: paymentId ? `/payments/${paymentId}` : `/payments`,
      category: 'payment',
      priority: status === 'failed' ? 'HIGH' : 'NORMAL'
    });
  }

  /**
   * Send support ticket notification
   */
  static async sendSupportNotification(userId: string, ticketId: string, action: string, subject?: string) {
    const priority = action === 'urgent' || action === 'escalated' ? 'URGENT' : 'NORMAL';
    
    return this.createNotification({
      userId,
      type: 'SUPPORT_UPDATE',
      title: 'Support Ticket Update',
      message: `Support ticket ${ticketId} has been ${action}${subject ? `: ${subject}` : ''}`,
      data: {
        ticketId,
        action,
        subject,
        type: 'support_update'
      },
      actionUrl: `/support/tickets/${ticketId}`,
      category: 'support',
      priority
    });
  }

  /**
   * Send booking notification
   */
  static async sendBookingNotification(userId: string, bookingId: string, action: string) {
    return this.createNotification({
      userId,
      type: 'BOOKING_UPDATE',
      title: 'Booking Update',
      message: `Your booking request has been ${action}`,
      data: {
        bookingId,
        action,
        type: 'booking_update'
      },
      actionUrl: `/bookings/${bookingId}`,
      category: 'booking',
      priority: action === 'confirmed' ? 'HIGH' : 'NORMAL'
    });
  }

  /**
   * Send system notification to all users or specific role
   */
  static async sendSystemNotification(message: string, type: 'INFO' | 'WARNING' | 'ERROR' = 'INFO', targetRole?: string) {
    try {
      let users;
      if (targetRole) {
        users = await prisma.user.findMany({
          where: {
            role: {
              name: targetRole
            }
          },
          select: { id: true }
        });
      } else {
        users = await prisma.user.findMany({
          select: { id: true }
        });
      }

      const notifications = users.map(user => ({
        userId: user.id,
        type: 'SYSTEM_ALERT' as const,
        title: 'System Notification',
        message,
        category: 'system',
        priority: type === 'ERROR' ? 'URGENT' as const : type === 'WARNING' ? 'HIGH' as const : 'NORMAL' as const
      }));

      return this.createBulkNotifications(notifications);
    } catch (error) {
      console.error('Error sending system notification:', error);
      throw error;
    }
  }

  /**
   * Send admin notification
   */
  static async sendAdminNotification(message: string, type: 'INFO' | 'WARNING' | 'ERROR' = 'INFO') {
    return this.sendSystemNotification(message, type, 'ADMIN');
  }

  /**
   * Clean up expired notifications
   */
  static async cleanupExpiredNotifications() {
    try {
      const deleted = await prisma.notification.deleteMany({
        where: {
          expiresAt: {
            lt: new Date()
          }
        }
      });
      
      console.log(`Cleaned up ${deleted.count} expired notifications`);
      return deleted.count;
    } catch (error) {
      console.error('Error cleaning up expired notifications:', error);
      throw error;
    }
  }

  /**
   * Get notification statistics for a user
   */
  static async getUserNotificationStats(userId: string) {
    try {
      const [total, unread, byType, byPriority] = await Promise.all([
        prisma.notification.count({
          where: { userId }
        }),
        prisma.notification.count({
          where: { userId, read: false }
        }),
        prisma.notification.groupBy({
          by: ['type'],
          where: { userId },
          _count: { id: true }
        }),
        prisma.notification.groupBy({
          by: ['priority'],
          where: { userId, read: false },
          _count: { id: true }
        })
      ]);

      return {
        total,
        unread,
        byType: byType.reduce((acc, item) => {
          acc[item.type] = item._count.id;
          return acc;
        }, {} as Record<string, number>),
        byPriority: byPriority.reduce((acc, item) => {
          acc[item.priority] = item._count.id;
          return acc;
        }, {} as Record<string, number>)
      };
    } catch (error) {
      console.error('Error getting notification stats:', error);
      throw error;
    }
  }
}
