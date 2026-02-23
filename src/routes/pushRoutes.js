// routes/pushRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const webpush = require('web-push');

// Configure web-push with VAPID keys from environment
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        'mailto:' + (process.env.CONTACT_EMAIL || 'brewurichard95@gmail.com'),
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log('✅ Web Push configured with VAPID keys');
} else {
    console.warn('⚠️ VAPID keys not found. Push notifications will not work.');
}

// =============================================
// GET VAPID PUBLIC KEY - Public endpoint (no auth required)
// =============================================
router.get('/vapid-public-key', (req, res) => {
    try {
        console.log('📢 VAPID public key requested');

        // Check if the key exists in environment
        if (!process.env.VAPID_PUBLIC_KEY) {
            console.error('❌ VAPID public key not found in environment variables');
            return res.status(500).json({
                success: false,
                error: 'VAPID public key not configured on server'
            });
        }

        // Return the public key
        res.json({
            success: true,
            publicKey: process.env.VAPID_PUBLIC_KEY
        });
    } catch (error) {
        console.error('Error getting VAPID key:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get VAPID key'
        });
    }
});

// =============================================
// SUBSCRIBE TO PUSH NOTIFICATIONS
// =============================================
router.post('/subscribe', protect, async (req, res) => {
    try {
        const { subscription, platform, deviceName, userAgent } = req.body;

        // Validate required fields
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({
                success: false,
                error: 'Invalid subscription data - endpoint required'
            });
        }

        // Find user
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Initialize pushSubscriptions if it doesn't exist
        if (!user.pushSubscriptions) {
            user.pushSubscriptions = [];
        }

        // Create new subscription object
        const newSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.keys?.p256dh || '',
                auth: subscription.keys?.auth || ''
            },
            platform: platform || 'web',
            deviceName: deviceName || 'Unknown Device',
            userAgent: userAgent || '',
            lastUsed: new Date(),
            isActive: true,
            createdAt: new Date()
        };

        // Check if subscription already exists
        const existingIndex = user.pushSubscriptions.findIndex(
            sub => sub.endpoint === subscription.endpoint
        );

        if (existingIndex >= 0) {
            // Update existing subscription while preserving createdAt
            user.pushSubscriptions[existingIndex] = {
                ...user.pushSubscriptions[existingIndex].toObject(),
                ...newSubscription,
                createdAt: user.pushSubscriptions[existingIndex].createdAt
            };
            console.log(`📱 Updated push subscription for user ${req.user.id}`);
        } else {
            // Add new subscription
            user.pushSubscriptions.push(newSubscription);
            console.log(`📱 Added new push subscription for user ${req.user.id}`);
        }

        await user.save();

        // Return success without exposing keys
        res.json({
            success: true,
            message: 'Successfully subscribed to push notifications',
            data: {
                endpoint: newSubscription.endpoint,
                platform: newSubscription.platform,
                deviceName: newSubscription.deviceName
            }
        });

    } catch (error) {
        console.error('Error subscribing to push:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to subscribe to push notifications'
        });
    }
});

// =============================================
// UNSUBSCRIBE FROM PUSH NOTIFICATIONS
// =============================================
router.post('/unsubscribe', protect, async (req, res) => {
    try {
        const { endpoint } = req.body;

        if (!endpoint) {
            return res.status(400).json({
                success: false,
                error: 'Endpoint required'
            });
        }

        // Remove subscription from user
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $pull: { pushSubscriptions: { endpoint: endpoint } } },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        console.log(`📱 Removed push subscription for user ${req.user.id}`);

        res.json({
            success: true,
            message: 'Successfully unsubscribed from push notifications'
        });

    } catch (error) {
        console.error('Error unsubscribing from push:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to unsubscribe from push notifications'
        });
    }
});

// =============================================
// GET USER'S PUSH SUBSCRIPTIONS
// =============================================
router.get('/subscriptions', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('pushSubscriptions');

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Sanitize subscriptions - remove sensitive key data
        const safeSubscriptions = (user.pushSubscriptions || []).map(sub => ({
            endpoint: sub.endpoint,
            platform: sub.platform,
            deviceName: sub.deviceName,
            lastUsed: sub.lastUsed,
            isActive: sub.isActive,
            createdAt: sub.createdAt
        }));

        res.json({
            success: true,
            data: safeSubscriptions
        });

    } catch (error) {
        console.error('Error getting push subscriptions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get push subscriptions'
        });
    }
});

// =============================================
// UPDATE NOTIFICATION PREFERENCES
// =============================================
router.put('/preferences', protect, async (req, res) => {
    try {
        const preferences = req.body;

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { notificationPreferences: preferences },
            { new: true }
        ).select('notificationPreferences');

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        console.log(`📱 Updated notification preferences for user ${req.user.id}`);

        res.json({
            success: true,
            data: user.notificationPreferences
        });

    } catch (error) {
        console.error('Error updating preferences:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update preferences'
        });
    }
});

// =============================================
// GET NOTIFICATION PREFERENCES
// =============================================
router.get('/preferences', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('notificationPreferences');

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            data: user.notificationPreferences || {}
        });

    } catch (error) {
        console.error('Error getting preferences:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get preferences'
        });
    }
});

// =============================================
// TEST NOTIFICATION (for debugging)
// =============================================
router.post('/test', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('pushSubscriptions');

        if (!user || !user.pushSubscriptions || user.pushSubscriptions.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No push subscriptions found'
            });
        }

        const payload = JSON.stringify({
            title: '🔔 Test Notification',
            body: 'This is a test push notification from Pulse',
            icon: '/logo192.png',
            badge: '/badge-72x72.png',
            data: {
                url: '/notifications',
                type: 'test',
                timestamp: new Date().toISOString()
            }
        });

        // Send to all active subscriptions
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
                            _id: req.user.id,
                            'pushSubscriptions.endpoint': subscription.endpoint
                        },
                        { $set: { 'pushSubscriptions.$.lastUsed': new Date() } }
                    );

                    return {
                        endpoint: subscription.endpoint,
                        success: true
                    };
                } catch (pushError) {
                    // If subscription is invalid (410 Gone), remove it
                    if (pushError.statusCode === 410) {
                        await User.findByIdAndUpdate(
                            req.user.id,
                            { $pull: { pushSubscriptions: { endpoint: subscription.endpoint } } }
                        );
                    }
                    return {
                        endpoint: subscription.endpoint,
                        success: false,
                        error: pushError.message
                    };
                }
            })
        );

        const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
        const failed = results.length - successful;

        res.json({
            success: true,
            message: `Test notification sent`,
            data: {
                total: results.length,
                successful,
                failed
            }
        });

    } catch (error) {
        console.error('Error sending test notification:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send test notification'
        });
    }
});

// =============================================
// SEND NOTIFICATION TO SPECIFIC USER (Internal use)
// =============================================
// This endpoint is for your notification service to trigger push notifications
router.post('/send/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;
        const { title, body, data, type } = req.body;

        if (!title || !body) {
            return res.status(400).json({
                success: false,
                error: 'Title and body are required'
            });
        }

        const user = await User.findById(userId).select('pushSubscriptions');

        if (!user || !user.pushSubscriptions || user.pushSubscriptions.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No subscriptions found for user'
            });
        }

        const payload = JSON.stringify({
            title,
            body,
            icon: '/logo192.png',
            badge: '/badge-72x72.png',
            data: data || { type: type || 'notification', url: '/' }
        });

        // Send to all active subscriptions
        const results = await Promise.allSettled(
            user.pushSubscriptions.map(async (subscription) => {
                try {
                    await webpush.sendNotification({
                        endpoint: subscription.endpoint,
                        keys: subscription.keys
                    }, payload);
                    return { success: true, endpoint: subscription.endpoint };
                } catch (error) {
                    if (error.statusCode === 410) {
                        // Remove invalid subscription
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

        res.json({
            success: true,
            message: `Notification sent to ${successCount} devices`,
            data: {
                total: results.length,
                successful: successCount
            }
        });

    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send notification'
        });
    }
});

module.exports = router;
