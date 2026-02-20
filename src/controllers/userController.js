// controllers/userController.js - COMPLETE FIXED FILE
const User = require('../models/User');
const NotificationService = require('../services/notificationService');

// =============================================
// ✅ GET USER PROFILES
// =============================================

/**
 * @desc    Get user by username
 * @route   GET /api/users/profile/:username
 * @access  Public/Private (with auth)
 */
exports.getUserByUsername = async (req, res) => {
  try {
    const { username } = req.params;
    
    const user = await User.findOne({ username })
      .select('-password -__v')
      .lean();
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Add computed virtuals since .lean() doesn't include them
    user.followerCount = user.followers?.length || 0;
    user.followingCount = user.following?.length || 0;
    
    // Check if current user is following (if authenticated)
    if (req.user) {
      user.isFollowing = user.followers?.includes(req.user.id) || false;
    }
    
    res.json(user);
  } catch (error) {
    console.error('getUserByUsername error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * @desc    Get user by ID
 * @route   GET /api/users/:id
 * @access  Public/Private (with auth)
 */
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findById(id)
      .select('-password -__v')
      .lean();
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Add computed virtuals
    user.followerCount = user.followers?.length || 0;
    user.followingCount = user.following?.length || 0;
    
    // Check if current user is following (if authenticated)
    if (req.user) {
      user.isFollowing = user.followers?.includes(req.user.id) || false;
    }
    
    res.json(user);
  } catch (error) {
    console.error('getUserById error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// =============================================
// ✅ FOLLOW/UNFOLLOW SYSTEM
// =============================================

/**
 * @desc    Follow a user
 * @route   POST /api/users/:id/follow
 * @access  Private
 */
exports.followUser = async (req, res) => {
  try {
    const { id: targetUserId } = req.params;
    const currentUserId = req.user.id;

    // Can't follow yourself
    if (currentUserId === targetUserId) {
      return res.status(400).json({ message: 'You cannot follow yourself' });
    }

    // Find both users
    const [currentUser, targetUser] = await Promise.all([
      User.findById(currentUserId),
      User.findById(targetUserId)
    ]);

    if (!currentUser || !targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already following
    if (currentUser.following.includes(targetUserId)) {
      return res.status(400).json({ message: 'Already following this user' });
    }

    // ✅ Add to following/followers arrays
    currentUser.following.push(targetUserId);
    targetUser.followers.push(currentUserId);

    // ✅ Update scores
    currentUser.updateScore('follower_gained');
    targetUser.updateScore('follower_gained');

    await Promise.all([currentUser.save(), targetUser.save()]);

    // ✅ Create notification
    try {
      await NotificationService.create({
        recipient: targetUserId,
        sender: currentUserId,
        type: 'new_follower',
        reference: {
          model: 'User',
          id: currentUserId
        },
        metadata: {
          username: currentUser.username
        }
      });
    } catch (notifError) {
      console.error('Failed to create follow notification:', notifError);
      // Don't fail the request
    }

    res.json({
      success: true,
      message: 'Successfully followed user',
      following: true,
      followerCount: targetUser.followers.length
    });
  } catch (error) {
    console.error('followUser error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * @desc    Unfollow a user
 * @route   DELETE /api/users/:id/follow
 * @access  Private
 */
exports.unfollowUser = async (req, res) => {
  try {
    const { id: targetUserId } = req.params;
    const currentUserId = req.user.id;

    const [currentUser, targetUser] = await Promise.all([
      User.findById(currentUserId),
      User.findById(targetUserId)
    ]);

    if (!currentUser || !targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if actually following
    if (!currentUser.following.includes(targetUserId)) {
      return res.status(400).json({ message: 'Not following this user' });
    }

    // ✅ Remove from arrays
    currentUser.following = currentUser.following.filter(
      id => id.toString() !== targetUserId
    );
    targetUser.followers = targetUser.followers.filter(
      id => id.toString() !== currentUserId
    );

    await Promise.all([currentUser.save(), targetUser.save()]);

    res.json({
      success: true,
      message: 'Successfully unfollowed user',
      following: false,
      followerCount: targetUser.followers.length
    });
  } catch (error) {
    console.error('unfollowUser error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// =============================================
// ✅ FOLLOWERS/FOLLOWING LISTS
// =============================================

/**
 * @desc    Get followers
 * @route   GET /api/users/:id/followers
 * @access  Public/Private
 */
exports.getFollowers = async (req, res) => {
  try {
    const { id } = req.params;
    let { page = 1, limit = 30 } = req.query;
    page = Math.max(1, parseInt(page));
    limit = Math.min(100, Math.max(1, parseInt(limit)));

    const skip = (page - 1) * limit;

    // Verify target user exists
    const targetUser = await User.findById(id).select('username isActive');
    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({ message: 'User not found' });
    }

    // ✅ Count total followers
    const total = await User.countDocuments({ following: id });

    // ✅ Get paginated followers
    const followers = await User.find({ following: id })
      .select('username name profilePicture bio isVerified rank score createdAt')
      .sort({ username: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Add following status for each follower (if authenticated)
    if (req.user) {
      const currentUser = await User.findById(req.user.id).select('following');
      const followingSet = new Set(currentUser.following.map(id => id.toString()));
      
      followers.forEach(user => {
        user.isFollowing = followingSet.has(user._id.toString());
      });
    }

    // Add computed counts
    followers.forEach(user => {
      user.followerCount = user.followers?.length || 0;
      user.followingCount = user.following?.length || 0;
      delete user.followers;
      delete user.following;
    });

    res.json({
      success: true,
      followers,
      followerCount: total,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('getFollowers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * @desc    Get following
 * @route   GET /api/users/:id/following
 * @access  Public/Private
 */
exports.getFollowing = async (req, res) => {
  try {
    const { id } = req.params;
    let { page = 1, limit = 30 } = req.query;
    page = Math.max(1, parseInt(page));
    limit = Math.min(100, Math.max(1, parseInt(limit)));

    const skip = (page - 1) * limit;

    const targetUser = await User.findById(id).select('username isActive');
    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({ message: 'User not found' });
    }

    // ✅ Count total following
    const total = await User.countDocuments({ followers: id });

    // ✅ Get paginated following
    const following = await User.find({ followers: id })
      .select('username name profilePicture bio isVerified rank score createdAt')
      .sort({ username: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Add following status (if authenticated)
    if (req.user) {
      const currentUser = await User.findById(req.user.id).select('following');
      const followingSet = new Set(currentUser.following.map(id => id.toString()));
      
      following.forEach(user => {
        user.isFollowing = followingSet.has(user._id.toString());
      });
    }

    // Add computed counts
    following.forEach(user => {
      user.followerCount = user.followers?.length || 0;
      user.followingCount = user.following?.length || 0;
      delete user.followers;
      delete user.following;
    });

    res.json({
      success: true,
      following,
      followingCount: total,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('getFollowing error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// =============================================
// ✅ USER SEARCH & SUGGESTIONS
// =============================================

/**
 * @desc    Search users
 * @route   GET /api/users/search
 * @access  Private
 */
// In userController.js - Add or update this function

/**
 * @desc    Search users by name or username
 * @route   GET /api/users/search
 * @access  Private
 */
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.trim() === '') {
      return res.json({ success: true, data: [] });
    }

    const searchRegex = new RegExp(q, 'i');
    
    const users = await User.find({
      $and: [
        { _id: { $ne: req.user.id } }, // Exclude current user
        {
          $or: [
            { name: searchRegex },
            { username: searchRegex },
            { email: searchRegex }
          ]
        }
      ]
    })
    .select('name username avatar bio isOnline lastSeen')
    .limit(20);

    // Add mutual follow information
    const currentUser = await User.findById(req.user.id);
    
    const usersWithFollowInfo = users.map(user => {
      const userObj = user.toObject();
      userObj.isFollowing = currentUser.following.includes(user._id);
      userObj.isFollowingBack = currentUser.followers.includes(user._id);
      userObj.isMutual = userObj.isFollowing && userObj.isFollowingBack;
      return userObj;
    });

    res.json({ 
      success: true, 
      data: usersWithFollowInfo 
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

/**
 * @desc    Get suggested users to follow
 * @route   GET /api/users/suggestions
 * @access  Private
 */
exports.getSuggestions = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const suggestions = await User.getSuggestions(req.user.id, limit);
    
    // Add following status (false since they're suggestions)
    suggestions.forEach(user => {
      user.isFollowing = false;
      user.followerCount = user.followers?.length || 0;
      user.followingCount = user.following?.length || 0;
      delete user.followers;
      delete user.following;
    });

    res.json({
      success: true,
      suggestions
    });
  } catch (error) {
    console.error('getSuggestions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// =============================================
// ✅ PROFILE UPDATE
// =============================================

/**
 * @desc    Update user profile
 * @route   PUT /api/users/profile
 * @access  Private
 */
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // Allowed fields to update
    const allowedUpdates = [
      'name', 'bio', 'profilePicture', 'coverPicture', 
      'privacySettings'
    ];

    // ❌ Don't allow username/email updates here - use separate endpoints
    const filteredUpdates = {};
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    });

    // Update user
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: filteredUpdates },
      { new: true, runValidators: true }
    ).select('-password -__v');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update score for completing profile
    if (updates.name && updates.bio) {
      user.updateScore('profile_completed');
      await user.save();
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('updateProfile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * @desc    Update privacy settings
 * @route   PUT /api/users/privacy
 * @access  Private
 */
exports.updatePrivacySettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const privacySettings = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { privacySettings } },
      { new: true }
    ).select('-password -__v');

    res.json({
      success: true,
      message: 'Privacy settings updated',
      privacySettings: user.privacySettings
    });
  } catch (error) {
    console.error('updatePrivacySettings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// =============================================
// ❌ REMOVED ALL BLOCKING FUNCTIONS
// =============================================
// The following functions have been REMOVED because your User model
// doesn't have blocking fields:
// - blockUser ❌
// - unblockUser ❌
// - getBlockedUsers ❌
// - getBlockStatus ❌