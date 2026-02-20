const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Centralized notification service
 * Use this service to create notifications from anywhere in your app
 */
class NotificationService {
  
  /**
   * Create a new notification
   * @param {Object} data - Notification data
   * @param {string} data.recipient - Recipient user ID
   * @param {string} data.sender - Sender user ID
   * @param {string} data.type - Notification type
   * @param {Object} data.reference - Reference object { model, id }
   * @param {Object} data.metadata - Additional metadata
   */
  static async create(data) {
    try {
      // Check if recipient has this notification type enabled
      const recipient = await User.findById(data.recipient).select('notificationPreferences');
      
      if (recipient && recipient.notificationPreferences) {
        const isEnabled = recipient.notificationPreferences[data.type];
        if (isEnabled === false) {
          console.log(`Notification type ${data.type} is disabled for user ${data.recipient}`);
          return null;
        }
      }

      // Create notification
      const notification = new Notification({
        recipient: data.recipient,
        sender: data.sender,
        type: data.type,
        reference: data.reference,
        metadata: data.metadata || {},
        isRead: false,
        isArchived: false
      });

      await notification.save();

      // Populate sender info
await notification.populate('sender', 'username name profilePicture');
      // Emit real-time event via WebSocket
      this.emitRealTime(notification);

      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create multiple notifications (bulk)
   * @param {Array} notifications - Array of notification data objects
   */
  static async createBulk(notifications) {
    try {
      const createdNotifications = [];
      
      for (const data of notifications) {
        const notification = await this.create(data);
        if (notification) {
          createdNotifications.push(notification);
        }
      }
      
      return createdNotifications;
    } catch (error) {
      console.error('Error creating bulk notifications:', error);
      throw error;
    }
  }

  /**
   * Emit real-time notification via WebSocket
   */
  static emitRealTime(notification) {
    try {
      const io = require('./websocket').getIO();
      if (io) {
        io.to(`user:${notification.recipient}`).emit('notification:new', notification);
      }
    } catch (error) {
      console.log('WebSocket not available, skipping real-time notification');
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, recipient: userId },
        { 
          isRead: true, 
          readAt: new Date() 
        },
        { new: true }
      );
      
      return notification;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId) {
    try {
      await Notification.updateMany(
        { recipient: userId, isRead: false },
        { 
          isRead: true, 
          readAt: new Date() 
        }
      );
    } catch (error) {
      console.error('Error marking all as read:', error);
      throw error;
    }
  }

  /**
   * Delete notification
   */
  static async delete(notificationId, userId) {
    try {
      await Notification.findOneAndDelete({
        _id: notificationId,
        recipient: userId
      });
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }
  }
}

module.exports = NotificationService;