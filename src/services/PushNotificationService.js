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
      console.log('✅ Web Push configured with VAPID keys');
    } else {
      console.warn('⚠️ VAPID keys not found. Push notifications will not work.');
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

      // Initialize pushSubscriptions if it doesn't exist
      user.pushSubscriptions = user.pushSubscriptions || [];

      // Remove old subscription with same endpoint if exists
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
        lastUsed: new Date(),
        createdAt: new Date(),
        isActive: true
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
    console.log('\n📱📱📱 ===== PUSH SERVICE ENTERED ===== 📱📱📱');
    console.log(`📍 Timestamp: ${new Date().toLocaleTimeString()}`);
    console.log(`👤 Target User ID: ${userId}`);
    console.log(`📋 Notification Type: ${notificationData.type}`);
    console.log(`📋 Title: "${notificationData.title}"`);
    console.log(`📋 Body: "${notificationData.body}"`);
    console.log(`📦 Full notification data:`, JSON.stringify(notificationData, null, 2));

    try {
      const User = require('mongoose').model('User');
      console.log(`🔍 Fetching user ${userId} from database...`);

      const user = await User.findById(userId).select('pushSubscriptions notificationPreferences');

      if (!user) {
        console.log(`❌ User ${userId} not found in database`);
        return false;
      }

      console.log(`✅ User found: ${user._id}`);
      console.log(`📊 User has ${user.pushSubscriptions?.length || 0} push subscriptions`);

      // Check if user has any push subscriptions
      if (!user.pushSubscriptions || user.pushSubscriptions.length === 0) {
        console.log(`ℹ️ No push subscriptions for user ${userId}`);
        return false;
      }

      // Log each subscription
      user.pushSubscriptions.forEach((sub, index) => {
        console.log(`   Subscription ${index + 1}:`);
        console.log(`      Platform: ${sub.platform}`);
        console.log(`      Device: ${sub.deviceName?.substring(0, 50)}...`);
        console.log(`      Endpoint: ${sub.endpoint?.substring(0, 60)}...`);
        console.log(`      Last Used: ${sub.lastUsed}`);
        console.log(`      Active: ${sub.isActive}`);
      });

      // Check user's notification preferences
      if (user.notificationPreferences) {
        console.log(`📋 User preferences:`, JSON.stringify(user.notificationPreferences, null, 2));

        // Global push preference
        if (user.notificationPreferences.global?.push === false) {
          console.log(`🚫 User has disabled all push notifications globally`);
          return false;
        }

        // Check specific notification type
        const type = notificationData.type;
        if (user.notificationPreferences.types?.[type]?.push === false) {
          console.log(`🚫 User has disabled ${type} notifications in preferences`);
          return false;
        } else {
          console.log(`✅ User has enabled ${type} notifications`);
        }
      }

      // Prepare notification payload based on platform
      console.log(`🔧 Building payload for notification...`);
      const payload = this.buildPayload(notificationData);
      console.log(`📦 Payload built:`, JSON.stringify(payload, null, 2));

      // Send to all user's devices
      console.log(`📤 Attempting to send to ${user.pushSubscriptions.length} devices...`);

      const sendPromises = user.pushSubscriptions.map(async (subscription, index) => {
        console.log(`\n📱 Processing device ${index + 1}/${user.pushSubscriptions.length}`);

        try {
          // Only send to active subscriptions
          if (subscription.isActive === false) {
            console.log(`⏭️ Skipping inactive subscription`);
            return false;
          }

          console.log(`   Platform: ${subscription.platform}`);
          console.log(`   Endpoint: ${subscription.endpoint?.substring(0, 60)}...`);

          let result = false;

          switch (subscription.platform) {
            case 'web':
              console.log(`   Sending web push via VAPID...`);
              result = await this.sendWebPush(subscription, payload);
              break;
            case 'ios':
            case 'android':
              console.log(`   Sending Expo push...`);
              result = await this.sendExpoPush(subscription, payload);
              break;
            default:
              console.log(`   Unknown platform, trying web push...`);
              result = await this.sendWebPush(subscription, payload);
          }

          // Update last used time on success
          if (result) {
            console.log(`   ✅ Successfully sent to device`);
            await User.updateOne(
              {
                _id: userId,
                'pushSubscriptions.endpoint': subscription.endpoint
              },
              {
                $set: { 'pushSubscriptions.$.lastUsed': new Date() }
              }
            );
          } else {
            console.log(`   ❌ Failed to send to device`);
          }

          return result;
        } catch (error) {
          console.error(`   ❌ Error sending to device:`, error.message);

          // If subscription is invalid/expired (410 Gone), remove it
          if (error.statusCode === 410 || error.statusCode === 404) {
            console.log(`   🔄 Removing invalid subscription for user ${userId}`);
            await this.removeSubscription(userId, subscription.endpoint);
          }
          return false;
        }
      });

      const results = await Promise.allSettled(sendPromises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;

      console.log(`\n📊 ===== PUSH SUMMARY =====`);
      console.log(`   Total devices: ${user.pushSubscriptions.length}`);
      console.log(`   Successful: ${successCount}`);
      console.log(`   Failed: ${results.length - successCount}`);
      console.log(`📱 Push sent to ${successCount}/${user.pushSubscriptions.length} devices for user ${userId}`);
      console.log('=====================================\n');

      return successCount > 0;

    } catch (error) {
      console.error('❌ Error sending push notification:', error);
      console.log('=====================================\n');
      return false;
    }
  }

  // Build notification payload with rich formatting
  buildPayload(notificationData) {
    // Default icons based on notification type
    const getIconForType = (type) => {
      const icons = {
        like: '/icons/like-icon.png',
        comment: '/icons/comment-icon.png',
        reply: '/icons/reply-icon.png',
        mention: '/icons/mention-icon.png',
        follow: '/icons/follow-icon.png',
        message: '/icons/message-icon.png',
        comment_like: '/icons/like-icon.png',
        poll_vote: '/icons/poll-icon.png',
        system: '/icons/system-icon.png'
      };
      return icons[type] || '/pulse-icon-192.png';
    };

    const getBadgeForType = (type) => {
      const badges = {
        like: '/badge-like.png',
        comment: '/badge-comment.png',
        reply: '/badge-reply.png',
        mention: '/badge-mention.png',
        follow: '/badge-follow.png',
        message: '/badge-message.png',
        comment_like: '/badge-like.png',
        poll_vote: '/badge-poll.png'
      };
      return badges[type] || '/pulse-badge-72.png';
    };

    // Get appropriate actions based on notification type
    const getActionsForType = (type) => {
      const commonActions = [
        {
          action: 'open',
          title: 'Open App'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ];

      const typeActions = {
        comment: [
          {
            action: 'reply',
            title: 'Reply'
          },
          {
            action: 'view',
            title: 'View Post'
          },
          {
            action: 'dismiss',
            title: 'Dismiss'
          }
        ],
        reply: [
          {
            action: 'reply',
            title: 'Reply'
          },
          {
            action: 'view',
            title: 'View Thread'
          },
          {
            action: 'dismiss',
            title: 'Dismiss'
          }
        ],
        message: [
          {
            action: 'reply',
            title: 'Reply'
          },
          {
            action: 'mark-read',
            title: 'Mark Read'
          },
          {
            action: 'dismiss',
            title: 'Dismiss'
          }
        ],
        follow: [
          {
            action: 'view-profile',
            title: 'View Profile'
          },
          {
            action: 'follow-back',
            title: 'Follow Back'
          },
          {
            action: 'dismiss',
            title: 'Dismiss'
          }
        ]
      };

      return typeActions[type] || commonActions;
    };

    // Format for web push (VAPID)
    return {
      title: notificationData.title || 'Pulse Notification',
      body: notificationData.body || notificationData.message || 'You have a new notification',
      icon: notificationData.icon || getIconForType(notificationData.type),
      badge: notificationData.badge || getBadgeForType(notificationData.type),
      image: notificationData.image || notificationData.data?.image,
      data: {
        url: notificationData.data?.url || notificationData.actionUrl || '/',
        type: notificationData.type || 'notification',
        notificationId: notificationData._id,
        sender: notificationData.data?.senderId || notificationData.sender,
        senderUsername: notificationData.data?.senderUsername || notificationData.senderUsername,
        postId: notificationData.data?.postId,
        commentId: notificationData.data?.commentId,
        metadata: notificationData.metadata || notificationData.data,
        timestamp: notificationData.data?.timestamp || new Date().toISOString()
      },
      actions: notificationData.actions || getActionsForType(notificationData.type),
      vibrate: notificationData.vibrate || [200, 100, 200],
      requireInteraction: notificationData.requireInteraction !== false,
      renotify: notificationData.renotify !== false,
      tag: notificationData.tag || notificationData.type, // Group similar notifications
      timestamp: Math.floor(new Date(notificationData.data?.timestamp || Date.now()).getTime()),
      silent: notificationData.silent || false
    };
  }

  // Send web push (VAPID)
  async sendWebPush(subscription, payload) {
    try {
      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: subscription.keys || {}
      };

      console.log(`   📤 Sending web push to endpoint: ${subscription.endpoint?.substring(0, 60)}...`);
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
      console.log('   ✅ Web push sent successfully');
      return true;
    } catch (error) {
      console.error('   ❌ Web push failed:', error.message);
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

      console.log(`   📤 Sending Expo push to: ${subscription.endpoint?.substring(0, 60)}...`);

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
        console.log('   ✅ Expo push sent successfully');
        return true;
      } else {
        console.error('   ❌ Expo push failed:', result);
        return false;
      }
    } catch (error) {
      console.error('   ❌ Expo push error:', error);
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