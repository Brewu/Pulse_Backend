// services/pushService.js
const webpush = require('web-push');
const User = require('../models/User');

// Configure web-push with VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        'mailto:' + (process.env.CONTACT_EMAIL || 'admin@pulse.com'),
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

/**
 * Send push notification to a specific user
 */
const sendToUser = async (userId, notification) => {
    try {
        const user = await User.findById(userId).select('pushSubscriptions');

        if (!user || !user.pushSubscriptions || user.pushSubscriptions.length === 0) {
            return { success: false, message: 'No subscriptions found' };
        }

        const payload = JSON.stringify({
            title: notification.title,
            body: notification.body,
            icon: notification.icon || '/logo192.png',
            badge: notification.badge || '/badge-72x72.png',
            data: notification.data || {},
            timestamp: Date.now()
        });

        const results = await Promise.allSettled(
            user.pushSubscriptions.map(async (subscription) => {
                try {
                    await webpush.sendNotification({
                        endpoint: subscription.endpoint,
                        keys: subscription.keys
                    }, payload);

                    // Update last used timestamp
                    await User.updateOne(
                        {
                            _id: userId,
                            'pushSubscriptions.endpoint': subscription.endpoint
                        },
                        { $set: { 'pushSubscriptions.$.lastUsed': new Date() } }
                    );

                    return { success: true, endpoint: subscription.endpoint };
                } catch (error) {
                    if (error.statusCode === 410) {
                        // Subscription expired - remove it
                        await User.findByIdAndUpdate(
                            userId,
                            { $pull: { pushSubscriptions: { endpoint: subscription.endpoint } } }
                        );
                    }
                    return { success: false, endpoint: subscription.endpoint, error: error.message };
                }
            })
        );

        const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;

        return {
            success: successCount > 0,
            sentCount: successCount,
            totalDevices: user.pushSubscriptions.length
        };

    } catch (error) {
        console.error('❌ Error sending push notification:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Send push notification to multiple users
 */
const sendToMany = async (userIds, notification) => {
    const results = await Promise.allSettled(
        userIds.map(userId => sendToUser(userId, notification))
    );

    return {
        total: userIds.length,
        successful: results.filter(r => r.status === 'fulfilled' && r.value?.success).length
    };
};

module.exports = {
    sendToUser,
    sendToMany
};