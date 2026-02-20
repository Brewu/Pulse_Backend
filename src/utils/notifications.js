const Notification = require('../models/Notification');
const webpush = require('web-push'); // For push notifications
const nodemailer = require('nodemailer'); // For email notifications

class NotificationService {
  constructor() {
    // Initialize web push (for browser notifications)
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        'mailto:your-email@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
    }
    
    // Initialize email transporter
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  /**
   * Create a new notification
   */
  async create(data) {
    try {
      const notification = await Notification.createNotification(data);
      
      // Send push notification if enabled
      if (this.shouldSendPush(notification)) {
        await this.sendPushNotification(notification);
      }
      
      // Send email notification if enabled
      if (this.shouldSendEmail(notification)) {
        await this.sendEmailNotification(notification);
      }
      
      return notification;
    } catch (error) {
      console.error('Notification creation error:', error);
      throw error;
    }
  }

  /**
   * Send push notification
   */
  async sendPushNotification(notification) {
    try {
      const user = await User.findById(notification.recipient)
        .select('pushTokens notificationPreferences');
      
      if (!user || !user.pushTokens.length) return;
      
      const payload = {
        title: notification.title,
        body: notification.message,
        icon: '/icon.png',
        badge: '/badge.png',
        data: {
          url: notification.actionUrl,
          notificationId: notification._id.toString()
        }
      };
      
      // Send to each push token
      for (const token of user.pushTokens) {
        try {
          await webpush.sendNotification(
            JSON.parse(token.token),
            JSON.stringify(payload)
          );
          
          notification.pushSent = true;
          notification.pushSentAt = new Date();
          await notification.save();
        } catch (error) {
          console.error('Push notification error:', error);
          // Remove invalid token
          if (error.statusCode === 410) {
            user.pushTokens = user.pushTokens.filter(t => t.token !== token.token);
            await user.save();
          }
        }
      }
    } catch (error) {
      console.error('Send push notification error:', error);
    }
  }

  /**
   * Send email notification
   */
  async sendEmailNotification(notification) {
    try {
      const user = await User.findById(notification.recipient)
        .select('email name notificationPreferences');
      
      if (!user || !user.email) return;
      
      const mailOptions = {
        from: `"Pulse App" <${process.env.SMTP_FROM}>`,
        to: user.email,
        subject: notification.title,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>${notification.title}</h2>
            <p>${notification.message}</p>
            ${notification.actionUrl ? `
            <a href="${process.env.FRONTEND_URL}${notification.actionUrl}" 
               style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
              View
            </a>
            ` : ''}
            <hr>
            <p style="color: #666; font-size: 12px;">
              <a href="${process.env.FRONTEND_URL}/notifications/preferences">Manage notification preferences</a>
            </p>
          </div>
        `
      };
      
      await this.transporter.sendMail(mailOptions);
      
      notification.emailSent = true;
      notification.emailSentAt = new Date();
      await notification.save();
    } catch (error) {
      console.error('Send email notification error:', error);
    }
  }

  /**
   * Check if push notification should be sent
   */
  shouldSendPush(notification) {
    // Check user preferences
    // This would check notification.recipient.notificationPreferences.push[notification.type]
    return true; // Simplified for example
  }

  /**
   * Check if email notification should be sent
   */
  shouldSendEmail(notification) {
    // Check user preferences
    return true; // Simplified for example
  }

  /**
   * Create message notification
   */
  async createMessageNotification(senderId, recipientId, messageId, conversationId) {
    return this.create({
      recipient: recipientId,
      sender: senderId,
      type: 'new_message',
      reference: {
        model: 'Message',
        id: messageId
      },
      metadata: {
        conversationId
      }
    });
  }

  /**
   * Create post like notification
   */
  async createPostLikeNotification(userId, postId, postOwnerId) {
    if (userId.toString() === postOwnerId.toString()) return; // Don't notify yourself
    
    return this.create({
      recipient: postOwnerId,
      sender: userId,
      type: 'post_like',
      reference: {
        model: 'Post',
        id: postId
      }
    });
  }

  /**
   * Create follower notification
   */
  async createFollowerNotification(followerId, followingId) {
    return this.create({
      recipient: followingId,
      sender: followerId,
      type: 'new_follower'
    });
  }

  // ... more specific notification methods
}

module.exports = new NotificationService();