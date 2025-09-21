import { NotificationMessage } from '../websocket';
import { NotificationService } from '../services/notificationService';

// Notification helper functions that can be used throughout the application

export const sendShipmentNotification = async (userId: string, trackingNumber: string, status: string, shipmentId?: string) => {
  try {
    await NotificationService.sendShipmentNotification(userId, trackingNumber, status, shipmentId);
    console.log(`Shipment notification sent for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error sending shipment notification:', error);
    return false;
  }
};

export const sendInvoiceNotification = async (userId: string, invoiceNumber: string, action: string, invoiceId?: string) => {
  try {
    await NotificationService.sendInvoiceNotification(userId, invoiceNumber, action, invoiceId);
    console.log(`Invoice notification sent for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error sending invoice notification:', error);
    return false;
  }
};

export const sendPaymentNotification = async (userId: string, amount: number, status: string, invoiceNumber?: string, paymentId?: string) => {
  try {
    await NotificationService.sendPaymentNotification(userId, amount, status, invoiceNumber, paymentId);
    console.log(`Payment notification sent for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error sending payment notification:', error);
    return false;
  }
};

export const broadcastSystemNotification = async (message: string, type: 'INFO' | 'WARNING' | 'ERROR' = 'INFO') => {
  try {
    await NotificationService.sendSystemNotification(message, type);
    console.log(`System notification sent to all users`);
    return true;
  } catch (error) {
    console.error('Error sending system notification:', error);
    return false;
  }
};

export const sendAdminNotification = async (message: string, type: 'INFO' | 'WARNING' | 'ERROR' = 'INFO') => {
  try {
    await NotificationService.sendAdminNotification(message, type);
    console.log(`Admin notification sent to all admins`);
    return true;
  } catch (error) {
    console.error('Error sending admin notification:', error);
    return false;
  }
};

// Support ticket notifications
export const sendSupportNotification = async (userId: string, ticketId: string, action: string, subject?: string) => {
  try {
    await NotificationService.sendSupportNotification(userId, ticketId, action, subject);
    console.log(`Support notification sent for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error sending support notification:', error);
    return false;
  }
};

// Booking notifications
export const sendBookingNotification = async (userId: string, bookingId: string, action: string) => {
  try {
    await NotificationService.sendBookingNotification(userId, bookingId, action);
    console.log(`Booking notification sent for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error sending booking notification:', error);
    return false;
  }
};

// New customer registration notification for admins
export const sendNewCustomerNotification = async (customerName: string, customerEmail: string) => {
  try {
    await NotificationService.sendAdminNotification(
      `New customer registered: ${customerName} (${customerEmail})`,
      'INFO'
    );
    console.log(`New customer notification sent to admins`);
    return true;
  } catch (error) {
    console.error('Error sending new customer notification:', error);
    return false;
  }
};