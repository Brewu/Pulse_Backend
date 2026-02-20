// controllers/conversationController.js
const Conversation = require('../models/Conversation');

// Get active conversations (main inbox)
exports.getActive = async (req, res) => {
  try {
    const conversations = await Conversation.getUserConversations(req.user._id);

    res.status(200).json({
      conversations
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to fetch conversations'
    });
  }
};

// Get archived conversations
exports.getArchived = async (req, res) => {
  try {
    const conversations = await Conversation.getArchivedConversations(req.user._id);

    res.status(200).json({
      conversations
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to fetch archived conversations'
    });
  }
};

// Get pinned conversations
exports.getPinned = async (req, res) => {
  try {
    const conversations = await Conversation.getPinnedConversations(req.user._id);

    res.status(200).json({
      conversations
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to fetch pinned conversations'
    });
  }
};

// Get total unread count across all conversations
exports.getTotalUnreadCount = async (req, res) => {
  try {
    const totalUnread = await Conversation.getTotalUnreadCount(req.user._id);

    res.status(200).json({
      unreadCount: totalUnread
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to fetch unread count'
    });
  }
};

// Create/start a new conversation
exports.createConversation = async (req, res) => {
  const { userId: otherUserId } = req.body;
  const currentUserId = req.user._id;

  if (!otherUserId) {
    return res.status(400).json({
      status: 'fail',
      message: 'Other user ID is required'
    });
  }

  if (otherUserId.toString() === currentUserId.toString()) {
    return res.status(400).json({
      status: 'fail',
      message: 'Cannot start conversation with yourself'
    });
  }

  try {
    const conversation = await Conversation.getOrCreate(currentUserId, otherUserId);

    res.status(201).json({
      conversation
    });
  } catch (err) {
    res.status(400).json({
      status: 'fail',
      message: err.message || 'Failed to create conversation'
    });
  }
};

// Get a single conversation by ID
exports.getOne = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  try {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
      isActive: true
    }).populate('participants', 'username name profilePicture isVerified rank score');

    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found or you are not a participant'
      });
    }

    res.status(200).json({
      conversation
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to fetch conversation'
    });
  }
};

// Archive conversation
exports.archive = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  try {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found'
      });
    }

    await conversation.archive(userId);

    res.status(200).json({
      status: 'success',
      message: 'Conversation archived'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to archive conversation'
    });
  }
};

// Unarchive conversation
exports.unarchive = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  try {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found'
      });
    }

    await conversation.unarchive(userId);

    res.status(200).json({
      status: 'success',
      message: 'Conversation unarchived'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to unarchive conversation'
    });
  }
};

// Mute conversation
exports.mute = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const { duration } = req.body;

  try {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found'
      });
    }

    await conversation.mute(userId, duration || null);

    res.status(200).json({
      status: 'success',
      message: 'Conversation muted'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to mute conversation'
    });
  }
};

// Unmute conversation
exports.unmute = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  try {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found'
      });
    }

    await conversation.unmute(userId);

    res.status(200).json({
      status: 'success',
      message: 'Conversation unmuted'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to unmute conversation'
    });
  }
};

// Pin conversation
exports.pin = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  try {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found'
      });
    }

    await conversation.pin(userId);

    res.status(200).json({
      status: 'success',
      message: 'Conversation pinned'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to pin conversation'
    });
  }
};

// Unpin conversation
exports.unpin = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  try {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found'
      });
    }

    await conversation.unpin(userId);

    res.status(200).json({
      status: 'success',
      message: 'Conversation unpinned'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to unpin conversation'
    });
  }
};

// Block conversation
exports.block = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const { reason } = req.body;

  try {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId
    });

    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found'
      });
    }

    await conversation.block(userId, reason);

    res.status(200).json({
      status: 'success',
      message: 'Conversation blocked'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to block conversation'
    });
  }
};

// Unblock conversation
exports.unblock = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  try {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      blockedBy: userId
    });

    if (!conversation) {
      return res.status(404).json({
        status: 'fail',
        message: 'Conversation not found or not blocked by you'
      });
    }

    await conversation.unblock();

    res.status(200).json({
      status: 'success',
      message: 'Conversation unblocked'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to unblock conversation'
    });
  }
};