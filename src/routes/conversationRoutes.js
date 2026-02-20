const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');

// Helper function to enrich conversation data
const enrichConversation = (conv, userId) => {
  const participantDetail = conv.participantDetails.find(
    p => p.user.toString() === userId.toString()
  );
  
  const otherParticipant = conv.type === 'direct' 
    ? conv.participants.find(p => p._id.toString() !== userId.toString())
    : null;

  return {
    ...conv.toObject(),
    unreadCount: participantDetail?.unreadCount || 0,
    isPinned: participantDetail?.isPinned || false,
    isMuted: participantDetail?.isMuted || false,
    mutedUntil: participantDetail?.mutedUntil,
    lastReadMessage: participantDetail?.lastReadMessage,
    otherParticipant,
    lastMessageAt: conv.lastMessageAt,
    isArchived: participantDetail?.isArchived || false
  };
};

// @desc    Get active conversations
// @route   GET /api/conversations
router.get('/', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const conversations = await Conversation.find({
      participants: req.user.id,
      'participantDetails.isArchived': { $ne: true },
      'participantDetails.isBlocked': { $ne: true }
    })
      .populate('participants', 'name username avatar isOnline lastSeen')
      .populate('lastMessage')
      .sort({ lastMessageAt: -1, pinnedAt: -1 })
      .skip(skip)
      .limit(limit);

    const enrichedConversations = conversations.map(conv => 
      enrichConversation(conv, req.user.id)
    );

    const total = await Conversation.countDocuments({
      participants: req.user.id,
      'participantDetails.isArchived': { $ne: true }
    });

    res.json({
      success: true,
      data: enrichedConversations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Get archived conversations
// @route   GET /api/conversations/archived
router.get('/archived', protect, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.id,
      'participantDetails.isArchived': true
    })
      .populate('participants', 'name username avatar isOnline lastSeen')
      .populate('lastMessage')
      .sort({ lastMessageAt: -1 });

    const enrichedConversations = conversations.map(conv => 
      enrichConversation(conv, req.user.id)
    );

    res.json({ success: true, data: enrichedConversations });
  } catch (error) {
    console.error('Get archived conversations error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Get pinned conversations
// @route   GET /api/conversations/pinned
router.get('/pinned', protect, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.id,
      'participantDetails.isPinned': true,
      'participantDetails.isArchived': false
    })
      .populate('participants', 'name username avatar isOnline lastSeen')
      .populate('lastMessage')
      .sort({ pinnedAt: -1 });

    const enrichedConversations = conversations.map(conv => 
      enrichConversation(conv, req.user.id)
    );

    res.json({ success: true, data: enrichedConversations });
  } catch (error) {
    console.error('Get pinned conversations error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Get unread count
// @route   GET /api/conversations/unread-count
router.get('/unread-count', protect, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.id
    });

    const totalUnread = conversations.reduce((sum, conv) => {
      const participantDetail = conv.participantDetails.find(
        p => p.user.toString() === req.user.id
      );
      return sum + (participantDetail?.unreadCount || 0);
    }, 0);

    res.json({ success: true, data: { totalUnread } });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Create new conversation
// @route   POST /api/conversations
router.post('/', protect, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID required' });
    }

    const currentUser = await User.findById(req.user.id);
    const otherUser = await User.findById(userId);

    if (!otherUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Check if they are mutual followers
    const areMutualFollowers = 
      currentUser.following.includes(userId) && 
      otherUser.following.includes(req.user.id);

    if (!areMutualFollowers) {
      return res.status(403).json({ 
        success: false, 
        error: 'You can only message mutual followers' 
      });
    }

    // Check if conversation already exists
    let conversation = await Conversation.findOne({
      type: 'direct',
      participants: { $all: [req.user.id, userId], $size: 2 }
    }).populate('participants', 'name username avatar isOnline lastSeen');

    if (!conversation) {
      // Create new conversation
      conversation = new Conversation({
        participants: [req.user.id, userId],
        type: 'direct',
        participantDetails: [
          { user: req.user.id },
          { user: userId }
        ]
      });

      await conversation.save();
      await conversation.populate('participants', 'name username avatar isOnline lastSeen');
      
      // Emit socket event for real-time updates
      if (req.io) {
        req.io.to(req.user.id.toString()).emit('conversation:new', conversation);
        req.io.to(userId.toString()).emit('conversation:new', conversation);
      }
    }

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    res.status(201).json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Get single conversation
// @route   GET /api/conversations/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    })
      .populate('participants', 'name username avatar isOnline lastSeen')
      .populate('lastMessage');

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    res.json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Archive conversation
// @route   POST /api/conversations/:id/archive
router.post('/:id/archive', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    }).populate('participants', 'name username avatar isOnline lastSeen');

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    if (participantIndex === -1) {
      return res.status(400).json({ success: false, error: 'User not in conversation' });
    }

    conversation.participantDetails[participantIndex].isArchived = true;
    conversation.participantDetails[participantIndex].isPinned = false;
    await conversation.save();

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    // Emit socket event
    if (req.io) {
      req.io.to(req.user.id.toString()).emit('conversation:archived', {
        conversationId: conversation._id,
        reason: 'archived'
      });
      
      // Also notify other participant
      const otherParticipant = conversation.participants.find(
        p => p._id.toString() !== req.user.id
      );
      if (otherParticipant) {
        req.io.to(otherParticipant._id.toString()).emit('conversation:archived', {
          conversationId: conversation._id,
          reason: 'archived_by_other'
        });
      }
    }

    res.json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Archive conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Unarchive conversation
// @route   POST /api/conversations/:id/unarchive
router.post('/:id/unarchive', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    }).populate('participants', 'name username avatar isOnline lastSeen');

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    conversation.participantDetails[participantIndex].isArchived = false;
    await conversation.save();

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    // Emit socket event
    if (req.io) {
      req.io.to(req.user.id.toString()).emit('conversation:reactivated', enrichedConversation);
      
      // Also notify other participant
      const otherParticipant = conversation.participants.find(
        p => p._id.toString() !== req.user.id
      );
      if (otherParticipant) {
        req.io.to(otherParticipant._id.toString()).emit('conversation:reactivated', enrichedConversation);
      }
    }

    res.json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Unarchive conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Mute conversation
// @route   POST /api/conversations/:id/mute
router.post('/:id/mute', protect, async (req, res) => {
  try {
    const { duration } = req.body;
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    }).populate('participants', 'name username avatar isOnline lastSeen');

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    conversation.participantDetails[participantIndex].isMuted = true;
    if (duration) {
      conversation.participantDetails[participantIndex].mutedUntil = 
        new Date(Date.now() + duration * 60 * 60 * 1000);
    }
    await conversation.save();

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    // Emit socket event
    if (req.io) {
      req.io.to(req.user.id.toString()).emit('conversation:updated', enrichedConversation);
    }

    res.json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Mute conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Unmute conversation
// @route   POST /api/conversations/:id/unmute
router.post('/:id/unmute', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    }).populate('participants', 'name username avatar isOnline lastSeen');

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    conversation.participantDetails[participantIndex].isMuted = false;
    conversation.participantDetails[participantIndex].mutedUntil = null;
    await conversation.save();

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    // Emit socket event
    if (req.io) {
      req.io.to(req.user.id.toString()).emit('conversation:updated', enrichedConversation);
    }

    res.json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Unmute conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Pin conversation
// @route   POST /api/conversations/:id/pin
router.post('/:id/pin', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    }).populate('participants', 'name username avatar isOnline lastSeen');

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    conversation.participantDetails[participantIndex].isPinned = true;
    conversation.participantDetails[participantIndex].pinnedAt = new Date();
    await conversation.save();

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    // Emit socket event
    if (req.io) {
      req.io.to(req.user.id.toString()).emit('conversation:updated', enrichedConversation);
    }

    res.json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Pin conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Unpin conversation
// @route   POST /api/conversations/:id/unpin
router.post('/:id/unpin', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    }).populate('participants', 'name username avatar isOnline lastSeen');

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    conversation.participantDetails[participantIndex].isPinned = false;
    conversation.participantDetails[participantIndex].pinnedAt = null;
    await conversation.save();

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    // Emit socket event
    if (req.io) {
      req.io.to(req.user.id.toString()).emit('conversation:updated', enrichedConversation);
    }

    res.json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Unpin conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Block conversation
// @route   POST /api/conversations/:id/block
router.post('/:id/block', protect, async (req, res) => {
  try {
    const { reason } = req.body;
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    }).populate('participants', 'name username avatar isOnline lastSeen');

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    conversation.participantDetails[participantIndex].isBlocked = true;
    conversation.participantDetails[participantIndex].blockedReason = reason;
    await conversation.save();

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    // Emit socket event
    if (req.io) {
      req.io.to(req.user.id.toString()).emit('conversation:updated', enrichedConversation);
      
      // Notify other participant they've been blocked
      const otherParticipant = conversation.participants.find(
        p => p._id.toString() !== req.user.id
      );
      if (otherParticipant) {
        req.io.to(otherParticipant._id.toString()).emit('conversation:blocked', {
          conversationId: conversation._id
        });
      }
    }

    res.json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Block conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Unblock conversation
// @route   POST /api/conversations/:id/unblock
router.post('/:id/unblock', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    }).populate('participants', 'name username avatar isOnline lastSeen');

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    conversation.participantDetails[participantIndex].isBlocked = false;
    conversation.participantDetails[participantIndex].blockedReason = null;
    await conversation.save();

    const enrichedConversation = enrichConversation(conversation, req.user.id);

    // Emit socket event
    if (req.io) {
      req.io.to(req.user.id.toString()).emit('conversation:updated', enrichedConversation);
      
      // Notify other participant they've been unblocked
      const otherParticipant = conversation.participants.find(
        p => p._id.toString() !== req.user.id
      );
      if (otherParticipant) {
        req.io.to(otherParticipant._id.toString()).emit('conversation:unblocked', {
          conversationId: conversation._id
        });
      }
    }

    res.json({ success: true, data: enrichedConversation });
  } catch (error) {
    console.error('Unblock conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// =============================================
// ✅ MESSAGE DELETION ENDPOINTS
// =============================================

// @desc    Delete message for current user only (soft delete)
// @route   DELETE /api/conversations/:conversationId/messages/:messageId
// @access  Private
router.delete('/:conversationId/messages/:messageId', protect, async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;

    // Check if user is in conversation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user.id
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        error: 'Conversation not found' 
      });
    }

    // Find the message
    const message = await Message.findOne({
      _id: messageId,
      conversation: conversationId
    });

    if (!message) {
      return res.status(404).json({ 
        success: false, 
        error: 'Message not found' 
      });
    }

    // Initialize deletedFor array if it doesn't exist
    if (!message.deletedFor) {
      message.deletedFor = [];
    }

    // Check if message is already deleted for this user
    if (message.deletedFor.includes(req.user.id)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Message already deleted' 
      });
    }

    // Add user to deletedFor array
    message.deletedFor.push(req.user.id);

    // If both participants have deleted the message, we could optionally hard delete
    const allParticipants = conversation.participants.map(p => p.toString());
    const allDeleted = allParticipants.every(p => message.deletedFor.includes(p));
    
    if (allDeleted) {
      // Optionally hard delete or just leave as soft deleted
      // await message.deleteOne();
    } else {
      await message.save();
    }

    // Emit socket event for real-time update
    if (req.io) {
      req.io.to(conversationId).emit('message:deleted', {
        messageId,
        conversationId,
        deletedFor: req.user.id
      });
    }

    res.json({ 
      success: true, 
      message: 'Message deleted successfully' 
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Delete message for everyone (permanent delete)
// @route   DELETE /api/conversations/:conversationId/messages/:messageId/everyone
// @access  Private
router.delete('/:conversationId/messages/:messageId/everyone', protect, async (req, res) => {
  try {
    const { conversationId, messageId } = req.params;

    // Check if user is in conversation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user.id
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        error: 'Conversation not found' 
      });
    }

    // Find the message
    const message = await Message.findOne({
      _id: messageId,
      conversation: conversationId
    });

    if (!message) {
      return res.status(404).json({ 
        success: false, 
        error: 'Message not found' 
      });
    }

    // Check if user is the sender (only sender can delete for everyone)
    if (message.sender.toString() !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        error: 'You can only delete your own messages' 
      });
    }

    // Check time limit (e.g., 1 hour)
    const deleteTimeLimit = 60 * 60 * 1000; // 1 hour
    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    
    if (messageAge > deleteTimeLimit) {
      return res.status(403).json({ 
        success: false, 
        error: 'Cannot delete messages older than 1 hour' 
      });
    }

    // Soft delete the message (mark as deleted but keep for reference)
    message.isDeleted = true;
    message.content = 'This message was deleted';
    message.attachments = [];
    await message.save();

    // Update conversation last message if this was the last message
    if (conversation.lastMessage?.toString() === messageId) {
      const previousMessage = await Message.findOne({
        conversation: conversationId,
        _id: { $ne: messageId }
      }).sort({ createdAt: -1 });
      
      conversation.lastMessage = previousMessage?._id;
      conversation.lastMessageAt = previousMessage?.createdAt || new Date();
      await conversation.save();
    }

    // Emit socket event
    if (req.io) {
      req.io.to(conversationId).emit('message:deleted', {
        messageId,
        conversationId,
        deletedForEveryone: true
      });
    }

    res.json({ 
      success: true, 
      message: 'Message deleted for everyone' 
    });
  } catch (error) {
    console.error('Delete for everyone error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// =============================================
// ✅ CONVERSATION DELETION ENDPOINTS
// =============================================

// @desc    Delete conversation for current user only
// @route   DELETE /api/conversations/:id
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        error: 'Conversation not found' 
      });
    }

    // Find the participant detail
    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    if (participantIndex === -1) {
      return res.status(400).json({ 
        success: false, 
        error: 'User not in conversation' 
      });
    }

    // Instead of deleting completely, we'll mark it as deleted for this user
    // This way we can keep the conversation history for other participants
    
    // Option 1: Soft delete - mark as deleted for this user
    if (!conversation.participantDetails[participantIndex].deletedForMe) {
      conversation.participantDetails[participantIndex].deletedForMe = [];
    }
    
    // Add all messages to deletedForMe for this user? Or just mark conversation as deleted
    // For simplicity, we'll add a deleted flag to participant details
    conversation.participantDetails[participantIndex].isDeleted = true;
    conversation.participantDetails[participantIndex].deletedAt = new Date();
    
    await conversation.save();

    // Check if all participants have deleted the conversation
    const allDeleted = conversation.participantDetails.every(p => p.isDeleted === true);
    
    if (allDeleted) {
      // Optionally hard delete the entire conversation and all messages
      // await Message.deleteMany({ conversation: conversation._id });
      // await conversation.deleteOne();
      console.log(`Conversation ${conversation._id} can be hard deleted - all participants deleted`);
    }

    // Emit socket event
    if (req.io) {
      req.io.to(req.user.id.toString()).emit('conversation:deleted', {
        conversationId: conversation._id
      });
      
      // Notify other participant that this user deleted the conversation
      const otherParticipant = conversation.participants.find(
        p => p.toString() !== req.user.id
      );
      if (otherParticipant) {
        req.io.to(otherParticipant.toString()).emit('conversation:participant_deleted', {
          conversationId: conversation._id,
          userId: req.user.id
        });
      }
    }

    res.json({ 
      success: true, 
      message: 'Conversation deleted successfully' 
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Permanently delete conversation for everyone (admin only or special case)
// @route   DELETE /api/conversations/:id/permanent
// @access  Private
router.delete('/:id/permanent', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user.id
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        error: 'Conversation not found' 
      });
    }

    // Optional: Only allow if both participants have deleted or if user is admin
    // For now, we'll require confirmation that both participants have deleted
    const allDeleted = conversation.participantDetails.every(p => p.isDeleted === true);
    
    if (!allDeleted) {
      return res.status(403).json({ 
        success: false, 
        error: 'Cannot permanently delete until all participants have deleted the conversation' 
      });
    }

    // Delete all messages in the conversation
    await Message.deleteMany({ conversation: conversation._id });
    
    // Delete the conversation
    await conversation.deleteOne();

    // Emit socket event
    if (req.io) {
      conversation.participants.forEach(participantId => {
        req.io.to(participantId.toString()).emit('conversation:permanently_deleted', {
          conversationId: conversation._id
        });
      });
    }

    res.json({ 
      success: true, 
      message: 'Conversation permanently deleted' 
    });
  } catch (error) {
    console.error('Permanent delete conversation error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;