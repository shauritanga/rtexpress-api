const { NotificationService } = require('../services/notificationService');

// Notification helper functions that can be used throughout the application

const sendShipmentNotification = async (userId, trackingNumber, status, shipmentId) => {
  try {
    await NotificationService.sendShipmentNotification(userId, trackingNumber, status, shipmentId);
    console.log(`Shipment notification sent for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error sending shipment notification:', error);
    return false;
  }
};

const sendInvoiceNotification = async (userId, invoiceNumber, action, invoiceId) => {
  try {
    await NotificationService.sendInvoiceNotification(userId, invoiceNumber, action, invoiceId);
    console.log(`Invoice notification sent for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error sending invoice notification:', error);
    return false;
  }
};

const sendPaymentNotification = async (userId, amount, status, invoiceNumber, paymentId) => {
  try {
    await NotificationService.sendPaymentNotification(userId, amount, status, invoiceNumber, paymentId);
    console.log(`Payment notification sent for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error sending payment notification:', error);
    return false;
  }
};

const broadcastSystemNotification = async (message, type = 'INFO') => {
  try {
    await NotificationService.sendSystemNotification(message, type);
    console.log(`System notification sent to all users`);
    return true;
  } catch (error) {
    console.error('Error sending system notification:', error);
    return false;
  }
};

const sendAdminNotification = async (message, type = 'INFO') => {
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
const sendSupportNotification = async (userId, ticketId, action, subject) => {
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
const sendBookingNotification = async (userId, bookingId, action) => {
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
const sendNewCustomerNotification = async (customerName, customerEmail) => {
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

// New shipment creation notification for admins
const sendNewShipmentNotification = async (customerName, trackingNumber, shipmentId) => {
  try {
    await NotificationService.sendAdminNotification(
      `New shipment created by ${customerName} - Tracking: ${trackingNumber}`,
      'INFO'
    );
    console.log(`New shipment notification sent to admins for tracking ${trackingNumber}`);
    return true;
  } catch (error) {
    console.error('Error sending new shipment notification:', error);
    return false;
  }
};

module.exports = {
  sendShipmentNotification,
  sendInvoiceNotification,
  sendPaymentNotification,
  broadcastSystemNotification,
  sendAdminNotification,
  sendSupportNotification,
  sendBookingNotification,
  sendNewCustomerNotification,
  sendNewShipmentNotification
};
