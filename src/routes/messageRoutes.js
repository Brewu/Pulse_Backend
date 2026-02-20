// routes/messageRoutes.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const { protect } = require('../middleware/auth');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');

// @desc    Send a message
// @route   POST /api/conversations/:conversationId/messages
// @access  Private
router.post('/:conversationId/messages', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Message content is required' 
      });
    }

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

    // ✅ CRITICAL: Check if conversation is archived (unfollowed)
    const userDetail = conversation.participantDetails.find(
      d => d.user.toString() === req.user.id
    );
    
    if (userDetail?.isArchived) {
      return res.status(403).json({ 
        success: false, 
        error: 'Cannot send message in archived conversation. You need to be mutual followers.' 
      });
    }

    // Get other participant
    const otherParticipantId = conversation.participants.find(
      p => p.toString() !== req.user.id
    );

    // ✅ Check if they are still mutual followers
    const currentUser = await User.findById(req.user.id);
    const otherUser = await User.findById(otherParticipantId);
    
    const areMutualFollowers = 
      currentUser.following.includes(otherParticipantId) && 
      otherUser.following.includes(req.user.id);

    if (!areMutualFollowers) {
      // Auto-archive the conversation if not mutual
      conversation.participantDetails.forEach(detail => {
        detail.isArchived = true;
      });
      await conversation.save();
      
      return res.status(403).json({ 
        success: false, 
        error: 'You are no longer mutual followers. Cannot send messages.' 
      });
    }

    // Get sender info
    const sender = await User.findById(req.user.id).select('name username avatar');

    // Create message
    const message = new Message({
      conversation: conversationId,
      sender: req.user.id,
      content: content.trim(),
      contentType: 'text',
      readBy: [{ user: req.user.id }],
      deliveredTo: [req.user.id]
    });

    await message.save();

    // Update conversation
    conversation.lastMessage = message._id;
    conversation.lastMessageAt = new Date();

    // Update unread count for other participant
    conversation.participantDetails.forEach(detail => {
      if (detail.user.toString() !== req.user.id) {
        detail.unreadCount += 1;
      }
    });

    await conversation.save();

    // Populate sender info for response
    await message.populate('sender', 'name username avatar');

    // Emit socket event if io is available
    if (req.io) {
      req.io.to(conversationId).emit('message:new', message);
      
      // Notify other participant
      req.io.to(otherParticipantId.toString()).emit('notification:new', {
        type: 'message',
        title: 'New message',
        body: `${sender.name} sent you a message`,
        data: { 
          conversationId, 
          messageId: message._id,
          sender: {
            id: sender._id,
            name: sender.name,
            username: sender.username,
            avatar: sender.avatar
          }
        }
      });
    }

    res.status(201).json({ success: true, data: message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Get messages in a conversation
// @route   GET /api/conversations/:conversationId/messages
// @access  Private
router.get('/:conversationId/messages', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before, after } = req.query;

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

    // Check if conversation is archived (still show messages but can't send new ones)
    const userDetail = conversation.participantDetails.find(
      d => d.user.toString() === req.user.id
    );
    
    const isArchived = userDetail?.isArchived || false;

    // Build query
    const query = { conversation: conversationId };
    
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    } else if (after) {
      query.createdAt = { $gt: new Date(after) };
    }

    // Get messages
    const messages = await Message.find(query)
      .populate('sender', 'name username avatar')
      .populate('replyTo')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Mark messages as delivered
    const messageIds = messages.map(m => m._id);
    await Message.updateMany(
      {
        _id: { $in: messageIds },
        deliveredTo: { $ne: req.user.id }
      },
      { $addToSet: { deliveredTo: req.user.id } }
    );

    res.json({
      success: true,
      data: messages.reverse(),
      pagination: {
        limit: parseInt(limit),
        hasMore: messages.length === parseInt(limit)
      },
      meta: {
        isArchived // Send this info to frontend to disable input
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// @desc    Mark conversation as read
// @route   POST /api/conversations/:conversationId/messages/read
// @access  Private
router.post('/:conversationId/messages/read', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;

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

    // Update participant details
    const participantIndex = conversation.participantDetails.findIndex(
      p => p.user.toString() === req.user.id
    );

    if (participantIndex !== -1) {
      // Get latest message
      const latestMessage = await Message.findOne({ conversation: conversationId })
        .sort({ createdAt: -1 });

      conversation.participantDetails[participantIndex].lastReadMessage = latestMessage?._id;
      conversation.participantDetails[participantIndex].unreadCount = 0;
      await conversation.save();
    }

    // Mark all messages as read
    await Message.updateMany(
      {
        conversation: conversationId,
        'readBy.user': { $ne: req.user.id }
      },
      {
        $addToSet: {
          readBy: { user: req.user.id, readAt: new Date() }
        }
      }
    );

    // Emit socket event if io is available
    if (req.io) {
      req.io.to(conversationId).emit('conversation:read', {
        conversationId,
        userId: req.user.id
      });
    }

    res.json({ success: true, message: 'Conversation marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;