// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const userController = require('../controllers/userController');
const NotificationMiddleware = require('../middleware/NotificationMiddleware');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');

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

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Public
 * @note    Must come AFTER specific routes like /search, /suggestions
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

// users.js - Add these routes
router.get('/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 10, sort } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const regex = new RegExp(q, 'i');

    const query = {
      $or: [
        { username: regex },
        { name: regex },
        { email: regex }
      ],
      isActive: true
    };

    let sortOptions = {};
    if (sort === 'followers') {
      sortOptions = { 'followers.length': -1 };
    } else if (sort === 'recent') {
      sortOptions = { createdAt: -1 };
    } else {
      // Relevance based on exact matches
      sortOptions = {};
    }

    const users = await User.find(query)
      .select('-password -__v -privacySettings -notificationPreferences')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Add computed fields
    const usersWithCounts = users.map(user => ({
      ...user,
      followersCount: user.followers?.length || 0,
      followingCount: user.following?.length || 0
    }));

    const total = await User.countDocuments(query);

    res.json({
      data: usersWithCounts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + users.length < total
      }
    });
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/suggestions', async (req, res) => {
  try {
    const currentUserId = req.user._id;

    const suggestions = await User.aggregate([
      { $match: { 
        _id: { $ne: currentUserId },
        isActive: true
      }},
      { $addFields: {
        score: {
          $add: [
            { $size: { $ifNull: ['$followers', []] } },
            { $multiply: ['$score', 0.5] }
          ]
        }
      }},
      { $sort: { score: -1 } },
      { $limit: 10 },
      { $project: {
        password: 0,
        __v: 0,
        privacySettings: 0,
        notificationPreferences: 0
      }}
    ]);

    res.json({ data: suggestions });
  } catch (error) {
    console.error('Suggestions error:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});
module.exports = router;