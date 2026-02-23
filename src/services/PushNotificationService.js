// services/pushNotificationService.js
const webpush = require('web-push');
const fetch = require('node-fetch');

class PushNotificationService {
  constructor() {
    // Initialize web-push with VAPID details from environment
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        'mailto:' + (process.env.CONTACT_EMAIL || 'admin@yourapp.com'),
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
    }
  }

  // Generate VAPID keys (run once to get these)
  static generateVAPIDKeys() {
    return webpush.generateVAPIDKeys();
  }

  // Store push subscription for a user
  async storeSubscription(userId, subscriptionData) {
    try {
      const User = require('mongoose').model('User');
      
      // Check if subscription already exists
      const user = await User.findById(userId);
      if (!user) return false;

      // Remove old subscription with same endpoint if exists
      user.pushSubscriptions = user.pushSubscriptions || [];
      user.pushSubscriptions = user.pushSubscriptions.filter(
        sub => sub.endpoint !== subscriptionData.endpoint
      );

      // Add new subscription
      user.pushSubscriptions.push({
        endpoint: subscriptionData.endpoint,
        keys: subscriptionData.keys || {},
        platform: subscriptionData.platform || 'web',
        deviceName: subscriptionData.deviceName || 'Unknown Device',
        userAgent: subscriptionData.userAgent,
        lastUsed: new Date()
      });

      await user.save();
      console.log(`📱 Push subscription stored for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error storing push subscription:', error);
      return false;
    }
  }

  // Remove push subscription
  async removeSubscription(userId, endpoint) {
    try {
      const User = require('mongoose').model('User');
      
      await User.findByIdAndUpdate(userId, {
        $pull: {
          pushSubscriptions: { endpoint: endpoint }
        }
      });
      
      console.log(`📱 Push subscription removed for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Error removing push subscription:', error);
      return false;
    }
  }

  // Send push notification to a specific user
  async sendToUser(userId, notificationData) {
    try {
      const User = require('mongoose').model('User');
      const user = await User.findById(userId).select('pushSubscriptions notificationPreferences');
      
      if (!user) {
        console.log(`User ${userId} not found`);
        return false;
      }

      // Check if user has any push subscriptions
      if (!user.pushSubscriptions || user.pushSubscriptions.length === 0) {
        console.log(`No push subscriptions for user ${userId}`);
        return false;
      }

      // Check user's notification preferences
      if (user.notificationPreferences) {
        // Global push preference
        if (user.notificationPreferences.push === false) {
          console.log(`User ${userId} has disabled all push notifications`);
          return false;
        }

        // Check specific notification type
        const type = notificationData.type;
        if (user.notificationPreferences[type] === false) {
          console.log(`User ${userId} has disabled ${type} notifications`);
          return false;
        }
      }

      // Prepare notification payload based on platform
      const payload = this.buildPayload(notificationData);

      // Send to all user's devices
      const sendPromises = user.pushSubscriptions.map(async (subscription) => {
        try {
          let result = false;
          
          switch (subscription.platform) {
            case 'web':
              result = await this.sendWebPush(subscription, payload);
              break;
            case 'ios':
            case 'android':
              result = await this.sendExpoPush(subscription, payload);
              break;
            default:
              result = await this.sendWebPush(subscription, payload);
          }

          // Update last used time on success
          if (result) {
            await User.updateOne(
              { 
                _id: userId, 
                'pushSubscriptions.endpoint': subscription.endpoint 
              },
              { 
                $set: { 'pushSubscriptions.$.lastUsed': new Date() } 
              }
            );
          }
          
          return result;
        } catch (error) {
          // If subscription is invalid/expired (410 Gone), remove it
          if (error.statusCode === 410 || error.statusCode === 404) {
            console.log(`Removing invalid subscription for user ${userId}`);
            await this.removeSubscription(userId, subscription.endpoint);
          }
          console.error(`Failed to send to device:`, error.message);
          return false;
        }
      });

      const results = await Promise.allSettled(sendPromises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
      
      console.log(`📱 Push sent to ${successCount}/${user.pushSubscriptions.length} devices for user ${userId}`);
      return successCount > 0;
      
    } catch (error) {
      console.error('Error sending push notification:', error);
      return false;
    }
  }

  // Build notification payload
  buildPayload(notificationData) {
    // Format for web push (VAPID)
    return {
      title: notificationData.title || 'New Notification',
      body: notificationData.message || 'You have a new notification',
      icon: '/icons/icon-192x192.png', // Your app icon
      badge: '/icons/badge-72x72.png',
      image: notificationData.metadata?.image,
      data: {
        url: notificationData.actionUrl || '/',
        type: notificationData.type,
        notificationId: notificationData._id,
        sender: notificationData.sender,
        senderUsername: notificationData.senderUsername,
        reference: notificationData.reference,
        metadata: notificationData.metadata,
        timestamp: notificationData.createdAt || new Date().toISOString()
      },
      actions: [
        {
          action: 'open',
          title: 'Open App'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ],
      vibrate: [200, 100, 200],
      requireInteraction: true,
      renotify: true,
      tag: notificationData.type, // Group similar notifications
      timestamp: Math.floor(new Date(notificationData.createdAt || Date.now()).getTime())
    };
  }

  // Send web push (VAPID)
  async sendWebPush(subscription, payload) {
    try {
      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: subscription.keys || {}
      };
      
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
      console.log('✅ Web push sent successfully');
      return true;
    } catch (error) {
      console.error('Web push failed:', error);
      throw error; // Re-throw to handle in caller
    }
  }

  // Send via Expo push service (for React Native/Expo apps)
  async sendExpoPush(subscription, payload) {
    try {
      const message = {
        to: subscription.endpoint, // Expo push token
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data,
        badge: 1,
        channelId: 'default', // Android channel
        priority: 'high',
        category: payload.data.type,
        mutableContent: true, // For iOS notification service extensions
      };

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'host': 'exp.host',
          'accept': 'application/json',
          'accept-encoding': 'gzip, deflate',
          'content-type': 'application/json',
        },
        body: JSON.stringify(message)
      });

      const result = await response.json();
      
      if (result.data?.status === 'ok') {
        console.log('✅ Expo push sent successfully');
        return true;
      } else {
        console.error('Expo push failed:', result);
        return false;
      }
    } catch (error) {
      console.error('Expo push error:', error);
      throw error;
    }
  }

  // Send badge update (silent push)
  async sendBadgeUpdate(userId, count) {
    try {
      const User = require('mongoose').model('User');
      const user = await User.findById(userId).select('pushSubscriptions');
      
      if (!user || !user.pushSubscriptions) return;

      const badgePayload = {
        type: 'badge_update',
        badge: count,
        data: { badge: count }
      };

      for (const subscription of user.pushSubscriptions) {
        try {
          if (subscription.platform === 'web') {
            await this.sendWebPush(subscription, badgePayload);
          } else {
            // For Expo, send silent notification
            await this.sendExpoPush(subscription, {
              title: '',
              body: '',
              data: { badge: count, type: 'badge_update' },
              badge: count
            });
          }
        } catch (error) {
          console.error('Badge update failed:', error);
        }
      }
    } catch (error) {
      console.error('Error sending badge update:', error);
    }
  }

  // Clean up expired/invalid subscriptions
  async cleanupSubscriptions() {
    try {
      const User = require('mongoose').model('User');
      
      // Remove subscriptions not used in last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await User.updateMany(
        {},
        {
          $pull: {
            pushSubscriptions: {
              lastUsed: { $lt: thirtyDaysAgo }
            }
          }
        }
      );

      console.log(`🧹 Cleaned up old push subscriptions: ${result.modifiedCount} users affected`);
    } catch (error) {
      console.error('Error cleaning up subscriptions:', error);
    }
  }
}

module.exports = new PushNotificationService();