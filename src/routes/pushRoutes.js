// routes/pushRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const webpush = require('web-push');

// Configure web-push with your VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:' + (process.env.CONTACT_EMAIL || 'admin@yourapp.com'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// =============================================
// GET VAPID PUBLIC KEY
// =============================================
router.get('/vapid-public-key', (req, res) => {
  try {
    res.json({ 
      success: true, 
      publicKey: process.env.VAPID_PUBLIC_KEY 
    });
  } catch (error) {
    console.error('Error getting VAPID key:', error);
    res.status(500).json({ error: 'Failed to get VAPID key' });
  }
});

// =============================================
// SUBSCRIBE TO PUSH NOTIFICATIONS
// =============================================
router.post('/subscribe', protect, async (req, res) => {
  try {
    const { subscription, platform, deviceName, userAgent } = req.body;
    
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription data' });
    }

    // Find user and update push subscriptions
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Initialize pushSubscriptions if it doesn't exist
    if (!user.pushSubscriptions) {
      user.pushSubscriptions = [];
    }

    // Check if subscription already exists
    const existingIndex = user.pushSubscriptions.findIndex(
      sub => sub.endpoint === subscription.endpoint
    );

    const newSubscription = {
      endpoint: subscription.endpoint,
      keys: subscription.keys || {},
      platform: platform || 'web',
      deviceName: deviceName || 'Unknown Device',
      userAgent: userAgent,
      lastUsed: new Date(),
      isActive: true
    };

    if (existingIndex >= 0) {
      // Update existing subscription
      user.pushSubscriptions[existingIndex] = {
        ...user.pushSubscriptions[existingIndex].toObject(),
        ...newSubscription,
        createdAt: user.pushSubscriptions[existingIndex].createdAt
      };
    } else {
      // Add new subscription
      user.pushSubscriptions.push(newSubscription);
    }

    await user.save();

    res.json({ 
      success: true, 
      message: 'Successfully subscribed to push notifications',
      subscription: newSubscription
    });
  } catch (error) {
    console.error('Error subscribing to push:', error);
    res.status(500).json({ error: 'Failed to subscribe to push notifications' });
  }
});

// =============================================
// UNSUBSCRIBE FROM PUSH NOTIFICATIONS
// =============================================
router.post('/unsubscribe', protect, async (req, res) => {
  try {
    const { endpoint } = req.body;
    
    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint required' });
    }

    // Remove subscription from user
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { pushSubscriptions: { endpoint: endpoint } } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      success: true, 
      message: 'Successfully unsubscribed from push notifications' 
    });
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    res.status(500).json({ error: 'Failed to unsubscribe from push notifications' });
  }
});

// =============================================
// GET USER'S PUSH SUBSCRIPTIONS
// =============================================
router.get('/subscriptions', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('pushSubscriptions');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      success: true, 
      data: user.pushSubscriptions || [] 
    });
  } catch (error) {
    console.error('Error getting push subscriptions:', error);
    res.status(500).json({ error: 'Failed to get push subscriptions' });
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
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      success: true, 
      data: user.notificationPreferences 
    });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// =============================================
// TEST NOTIFICATION (for debugging)
// =============================================
router.post('/test', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('pushSubscriptions');
    
    if (!user || !user.pushSubscriptions || user.pushSubscriptions.length === 0) {
      return res.status(400).json({ error: 'No push subscriptions found' });
    }

    const payload = JSON.stringify({
      title: 'Test Notification',
      body: 'This is a test push notification',
      icon: '/logo192.png',
      badge: '/badge-72x72.png',
      data: {
        url: '/notifications',
        type: 'test'
      }
    });

    // Send to first subscription
    const subscription = user.pushSubscriptions[0];
    
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: subscription.keys
      }, payload);
      
      res.json({ success: true, message: 'Test notification sent' });
    } catch (pushError) {
      console.error('Push send error:', pushError);
      
      // If subscription is invalid, remove it
      if (pushError.statusCode === 410) {
        await User.findByIdAndUpdate(
          req.user.id,
          { $pull: { pushSubscriptions: { endpoint: subscription.endpoint } } }
        );
      }
      
      res.status(500).json({ error: 'Failed to send test notification' });
    }
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

module.exports = router;