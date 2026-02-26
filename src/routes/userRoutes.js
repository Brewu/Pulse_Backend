// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const userController = require('../controllers/userController');
const NotificationMiddleware = require('../middleware/NotificationMiddleware');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const crypto = require('crypto'); // Add for phone verification
const { sendPhoneVerificationCode } = require('../services/notificationService'); // Add this

// ======================
// ✅ PUBLIC ROUTES (Optional auth for following status)
// ======================

/**
 * @route   GET /api/users/profile/:username
 * @desc    Get user profile by username
 * @access  Public (with optional auth)
 */
router.get('/profile/:username', protect, userController.getUserByUsername);

// ======================
// ✅ PROTECTED ROUTES (Require Authentication) - ORDER MATTERS!
// ======================

/**
 * @route   GET /api/users/search
 * @desc    Search users
 * @access  Private
 * @note    Must come BEFORE /:id route
 */
router.get('/search', protect, userController.searchUsers);

/**
 * @route   GET /api/users/suggestions
 * @desc    Get suggested users to follow
 * @access  Private
 */
router.get('/suggestions', protect, userController.getSuggestions);

// ======================
// ✅ PHONE NUMBER MANAGEMENT
// ======================

/**
 * @route   PUT /api/users/phone
 * @desc    Add or update phone number
 * @access  Private
 */
router.put('/phone', protect, async (req, res) => {
  try {
    const { phoneNumber, phoneCountryCode } = req.body;

    if (!phoneNumber || !phoneCountryCode) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and country code are required'
      });
    }

    // Validate phone number format (basic)
    const phoneRegex = /^\d{10,15}$/; // 10-15 digits
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }

    // Check if phone number is already used by another user
    const existingUser = await User.findOne({
      phoneNumber,
      phoneCountryCode,
      _id: { $ne: req.user._id }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already in use'
      });
    }

    // Update user
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        phoneNumber,
        phoneCountryCode,
        isPhoneVerified: false,
        'loginMethods.phone': true
      },
      { new: true }
    ).select('-password -resetPasswordToken -resetPasswordExpire -phoneVerificationCode -phoneVerificationExpire');

    res.json({
      success: true,
      message: 'Phone number updated successfully. Please verify your number.',
      user
    });

  } catch (error) {
    console.error('❌ Update phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update phone number'
    });
  }
});

/**
 * @route   POST /api/users/phone/send-verification
 * @desc    Send verification code to phone
 * @access  Private
 */
router.post('/phone/send-verification', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user.phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please add a phone number first'
      });
    }

    if (user.isPhoneVerified) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is already verified'
      });
    }

    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash and store code
    const hashedCode = crypto
      .createHash('sha256')
      .update(verificationCode)
      .digest('hex');

    user.phoneVerificationCode = hashedCode;
    user.phoneVerificationExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save({ validateBeforeSave: false });

    // Send SMS via notification service
    await sendPhoneVerificationCode(user, verificationCode);

    res.json({
      success: true,
      message: 'Verification code sent to your phone'
    });

  } catch (error) {
    console.error('❌ Send verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send verification code'
    });
  }
});

/**
 * @route   POST /api/users/phone/verify
 * @desc    Verify phone number with code
 * @access  Private
 */
router.post('/phone/verify', protect, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required'
      });
    }

    const user = await User.findById(req.user._id).select('+phoneVerificationCode +phoneVerificationExpire');

    if (!user.phoneVerificationCode || !user.phoneVerificationExpire) {
      return res.status(400).json({
        success: false,
        message: 'No verification code found. Request a new one.'
      });
    }

    // Check if expired
    if (user.phoneVerificationExpire < Date.now()) {
      // Clear expired codes
      user.phoneVerificationCode = undefined;
      user.phoneVerificationExpire = undefined;
      await user.save({ validateBeforeSave: false });

      return res.status(400).json({
        success: false,
        message: 'Verification code expired. Request a new one.'
      });
    }

    // Verify code
    const hashedCode = crypto
      .createHash('sha256')
      .update(code)
      .digest('hex');

    if (hashedCode !== user.phoneVerificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Mark as verified
    user.isPhoneVerified = true;
    user.phoneVerifiedAt = new Date();
    user.phoneVerificationCode = undefined;
    user.phoneVerificationExpire = undefined;
    await user.save();

    // Remove sensitive fields from response
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpire;

    res.json({
      success: true,
      message: 'Phone number verified successfully',
      user: userResponse
    });

  } catch (error) {
    console.error('❌ Verify phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify phone number'
    });
  }
});

/**
 * @route   DELETE /api/users/phone
 * @desc    Remove phone number from account
 * @access  Private
 */
router.delete('/phone', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $unset: {
        phoneNumber: "",
        phoneCountryCode: "",
        phoneVerificationCode: "",
        phoneVerificationExpire: ""
      },
      isPhoneVerified: false,
      'loginMethods.phone': false
    });

    res.json({
      success: true,
      message: 'Phone number removed successfully'
    });

  } catch (error) {
    console.error('❌ Remove phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove phone number'
    });
  }
});

// ======================
// ✅ USER PROFILE ROUTES
// ======================

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Public
 * @note    Must come AFTER specific routes like /search, /suggestions, /phone
 */
router.get('/:id', userController.getUserById);

/**
 * @route   GET /api/users/:id/followers
 * @desc    Get user's followers
 * @access  Public
 */
router.get('/:id/followers', userController.getFollowers);

/**
 * @route   GET /api/users/:id/following
 * @desc    Get users that a user is following
 * @access  Public
 */
router.get('/:id/following', userController.getFollowing);

// ======================
// ✅ FOLLOW/UNFOLLOW ROUTES (With conversation management)
// ======================

/**
 * @route   POST /api/users/:id/follow
 * @desc    Follow a user
 * @access  Private
 */
router.post('/:id/follow',
  protect,
  async (req, res, next) => {
    try {
      // Store the users for later use
      req.followData = { currentUserId: req.user.id, targetUserId: req.params.id };
      next();
    } catch (error) {
      next(error);
    }
  },
  userController.followUser,
  async (req, res, next) => {
    try {
      // After successful follow, check if it's mutual and create conversation
      if (req.followData) {
        const { currentUserId, targetUserId } = req.followData;

        // Get both users to check mutual follow status
        const currentUser = await User.findById(currentUserId);
        const targetUser = await User.findById(targetUserId);

        // Check if it's mutual (both follow each other)
        if (currentUser && targetUser &&
          currentUser.following.includes(targetUserId) &&
          targetUser.following.includes(currentUserId)) {

          // Check if conversation already exists
          let conversation = await Conversation.findOne({
            type: 'direct',
            participants: { $all: [currentUserId, targetUserId], $size: 2 }
          });

          if (!conversation) {
            // Create new conversation
            conversation = new Conversation({
              participants: [currentUserId, targetUserId],
              type: 'direct',
              participantDetails: [
                {
                  user: currentUserId,
                  isArchived: false,
                  isPinned: false,
                  isMuted: false,
                  unreadCount: 0
                },
                {
                  user: targetUserId,
                  isArchived: false,
                  isPinned: false,
                  isMuted: false,
                  unreadCount: 0
                }
              ]
            });

            await conversation.save();

            // Populate for socket events
            await conversation.populate('participants', 'name username avatar isOnline lastSeen');

            // Emit socket events if available
            if (req.io) {
              req.io.to(currentUserId.toString()).emit('conversation:new', conversation);
              req.io.to(targetUserId.toString()).emit('conversation:new', conversation);
            }

            console.log(`✅ Created conversation between mutual followers: ${currentUserId} and ${targetUserId}`);
          } else {
            // If conversation exists but was archived, reactivate it
            let updated = false;

            conversation.participantDetails.forEach(detail => {
              if (detail.isArchived) {
                detail.isArchived = false;
                updated = true;
              }
            });

            if (updated) {
              await conversation.save();

              if (req.io) {
                req.io.to(currentUserId.toString()).emit('conversation:reactivated', conversation);
                req.io.to(targetUserId.toString()).emit('conversation:reactivated', conversation);
              }

              console.log(`✅ Reactivated conversation between mutual followers: ${currentUserId} and ${targetUserId}`);
            }
          }
        }
      }
      next();
    } catch (error) {
      console.error('Error creating conversation:', error);
      next();
    }
  },
  NotificationMiddleware.afterFollow
);

/**
 * @route   DELETE /api/users/:id/follow
 * @desc    Unfollow a user
 * @access  Private
 */
router.delete('/:id/follow',
  protect,
  async (req, res, next) => {
    try {
      // Store the users for later use
      req.unfollowData = { currentUserId: req.user.id, targetUserId: req.params.id };
      next();
    } catch (error) {
      next(error);
    }
  },
  userController.unfollowUser,
  async (req, res, next) => {
    try {
      // After successful unfollow, archive/disable conversation
      if (req.unfollowData) {
        const { currentUserId, targetUserId } = req.unfollowData;

        // Find conversation between these users
        const conversation = await Conversation.findOne({
          type: 'direct',
          participants: { $all: [currentUserId, targetUserId], $size: 2 }
        });

        if (conversation) {
          // Archive for both users (they can't message each other anymore)
          let updated = false;

          conversation.participantDetails.forEach(detail => {
            const userId = detail.user.toString();
            if (userId === currentUserId || userId === targetUserId) {
              if (!detail.isArchived) {
                detail.isArchived = true;
                updated = true;
              }
            }
          });

          if (updated) {
            await conversation.save();

            // Emit socket events if available
            if (req.io) {
              req.io.to(currentUserId.toString()).emit('conversation:archived', {
                conversationId: conversation._id,
                reason: 'unfollowed'
              });
              req.io.to(targetUserId.toString()).emit('conversation:archived', {
                conversationId: conversation._id,
                reason: 'unfollowed'
              });
            }

            console.log(`📦 Archived conversation due to unfollow: ${currentUserId} unfollowed ${targetUserId}`);
          }
        }
      }
      next();
    } catch (error) {
      console.error('Error archiving conversation:', error);
      next();
    }
  }
);

// ======================
// ✅ PROFILE MANAGEMENT
// ======================

/**
 * @route   PUT /api/users/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', protect, userController.updateProfile);

/**
 * @route   PUT /api/users/privacy
 * @desc    Update privacy settings
 * @access  Private
 */
router.put('/privacy', protect, userController.updatePrivacySettings);

// ======================
// ✅ NOTIFICATION PREFERENCES
// ======================

/**
 * @route   GET /api/users/notification-preferences
 * @desc    Get user's notification preferences
 * @access  Private
 */
router.get('/notification-preferences', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('notificationPreferences');

    res.json({
      success: true,
      data: user.notificationPreferences || {}
    });
  } catch (error) {
    console.error('Error getting preferences:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   PUT /api/users/notification-preferences
 * @desc    Update notification preferences
 * @access  Private
 */
router.put('/notification-preferences', protect, async (req, res) => {
  try {
    const preferences = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { notificationPreferences: preferences },
      { new: true }
    ).select('notificationPreferences');

    res.json({
      success: true,
      data: user.notificationPreferences
    });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ======================
// ✅ ACCOUNT MANAGEMENT
// ======================

/**
 * @route   DELETE /api/users/account
 * @desc    Deactivate/delete user account
 * @access  Private
 */
router.delete('/account', protect, async (req, res) => {
  try {
    const { password, confirmDelete } = req.body;

    if (!confirmDelete) {
      return res.status(400).json({
        success: false,
        message: 'Please confirm account deletion'
      });
    }

    const user = await User.findById(req.user._id).select('+password');

    // Verify password if account has password
    if (user.password) {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Password is required to delete account'
        });
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password'
        });
      }
    }

    // Soft delete - set inactive
    user.isActive = false;
    await user.save();

    // Remove token
    res.clearCookie('token');

    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });

  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;