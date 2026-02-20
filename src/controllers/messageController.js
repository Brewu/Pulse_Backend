// controllers/messageController.js
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

// Helper: Get conversation if user is a participant
const verifyParticipant = async (conversationId, userId) => {
  return await Conversation.findOne({
    _id: conversationId,
    participants: userId,
    isActive: true
  });
};

// ========== SEND MESSAGE ==========
exports.sendMessage = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  const {
    content,
    type = 'text',
    attachments = [],
    replyTo,
    clientMessageId,
    location,
    contact
  } = req.body;

  if (type === 'text' && (!content || content.trim() === '')) {
    return res.status(400).json({
      status: 'fail',
      message: 'Text message cannot be empty'
    });
  }

  const conversation = await verifyParticipant(conversationId, userId);
  if (!conversation) {
    return res.status(403).json({
      status: 'fail',
      message: 'You are not a participant in this conversation or it does not exist'
    });
  }

  try {
    const message = await Message.sendMessage(
      conversationId,
      userId,
      content,
      {
        type,
        attachments,
        replyTo,
        clientMessageId,
        location,
        contact,
        deviceInfo: {
          platform: req.headers['user-agent'] || 'unknown',
          appVersion: req.headers['app-version'],
          ip: req.ip
        }
      }
    );

    res.status(201).json({
      status: 'success',
      data: { message }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to send message'
    });
  }
};

// ========== GET MESSAGES IN CONVERSATION ==========
exports.getMessages = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  const conversation = await verifyParticipant(conversationId, userId);
  if (!conversation) {
    return res.status(403).json({
      status: 'fail',
      message: 'You are not a participant in this conversation or it does not exist'
    });
  }

  const {
    limit = 50,
    before,
    after,
    includeSystem = false
  } = req.query;

  try {
    const messages = await Message.getConversationMessages(
      conversationId,
      userId,
      {
        limit: +limit,
        before: before || null,
        after: after || null,
        includeSystem: includeSystem === 'true'
      }
    );

    res.status(200).json({
      status: 'success',
      results: messages.length,
      data: { messages }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to fetch messages'
    });
  }
};

// ========== MARK CONVERSATION AS READ ==========
exports.markConversationAsRead = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  const conversation = await verifyParticipant(conversationId, userId);
  if (!conversation) {
    return res.status(403).json({
      status: 'fail',
      message: 'You are not a participant in this conversation or it does not exist'
    });
  }

  try {
    await conversation.markAsRead(userId);

    res.status(200).json({
      status: 'success',
      message: 'Conversation marked as read'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to mark conversation as read'
    });
  }
};

// ========== MARK SINGLE MESSAGE AS READ ==========
exports.markMessageAsRead = async (req, res) => {
  const { conversationId, messageId } = req.params;
  const userId = req.user._id;

  const conversation = await verifyParticipant(conversationId, userId);
  if (!conversation) {
    return res.status(403).json({
      status: 'fail',
      message: 'You are not a participant in this conversation or it does not exist'
    });
  }

  const message = await Message.findOne({
    _id: messageId,
    conversation: conversationId,
    recipient: userId
  });

  if (!message) {
    return res.status(404).json({
      status: 'fail',
      message: 'Message not found or not addressed to you'
    });
  }

  try {
    await message.markAsRead(userId);

    res.status(200).json({
      status: 'success',
      message: 'Message marked as read'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to mark message as read'
    });
  }
};

// ========== GET MEDIA IN CONVERSATION ==========
exports.getConversationMedia = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const { type, limit = 50 } = req.query;

  const conversation = await verifyParticipant(conversationId, userId);
  if (!conversation) {
    return res.status(403).json({
      status: 'fail',
      message: 'You are not a participant in this conversation or it does not exist'
    });
  }

  try {
    const media = await Message.getConversationMedia(
      conversationId,
      type || null,
      +limit
    );

    res.status(200).json({
      status: 'success',
      results: media.length,
      data: { media }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to fetch media'
    });
  }
};

// ========== SEARCH MESSAGES ACROSS USER'S CONVERSATIONS ==========
exports.searchMessages = async (req, res) => {
  const userId = req.user._id;
  const { q: searchTerm, limit = 50 } = req.query;

  if (!searchTerm || searchTerm.trim() === '') {
    return res.status(400).json({
      status: 'fail',
      message: 'Search term is required'
    });
  }

  try {
    const results = await Message.searchMessages(userId, searchTerm.trim(), +limit);

    res.status(200).json({
      status: 'success',
      results: results.length,
      data: { messages: results }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to search messages'
    });
  }
};

// ========== EDIT MESSAGE ==========
exports.editMessage = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;
  const { content } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({
      status: 'fail',
      message: 'New content cannot be empty'
    });
  }

  const message = await Message.findOne({
    _id: messageId,
    sender: userId
  });

  if (!message) {
    return res.status(404).json({
      status: 'fail',
      message: 'Message not found or you are not the sender'
    });
  }

  try {
    await message.editMessage(content.trim(), userId);

    // Refresh message to return updated version
    await message.populate('sender', 'username name profilePicture');

    res.status(200).json({
      status: 'success',
      data: { message }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to edit message'
    });
  }
};

// ========== DELETE MESSAGE (SOFT DELETE FOR SELF) ==========
exports.softDeleteMessage = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;

  const message = await Message.findOne({
    _id: messageId,
    $or: [{ sender: userId }, { recipient: userId }]
  });

  if (!message) {
    return res.status(404).json({
      status: 'fail',
      message: 'Message not found'
    });
  }

  try {
    await message.softDelete(userId);

    res.status(200).json({
      status: 'success',
      message: 'Message deleted for you'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to delete message'
    });
  }
};

// ========== DELETE MESSAGE FOR EVERYONE ==========
exports.deleteMessageForEveryone = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;

  const message = await Message.findOne({
    _id: messageId,
    sender: userId
  });

  if (!message) {
    return res.status(404).json({
      status: 'fail',
      message: 'Message not found or you are not the sender'
    });
  }

  try {
    await message.deleteForEveryone(userId);

    res.status(200).json({
      status: 'success',
      message: 'Message deleted for everyone'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to delete message for everyone'
    });
  }
};

// ========== ADD REACTION TO MESSAGE ==========
exports.addReaction = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;
  const { emoji } = req.body;

  if (!emoji) {
    return res.status(400).json({
      status: 'fail',
      message: 'Emoji is required'
    });
  }

  const message = await Message.findById(messageId);
  if (!message) {
    return res.status(404).json({
      status: 'fail',
      message: 'Message not found'
    });
  }

  // Verify user is participant
  const conversation = await Conversation.findById(message.conversation);
  if (!conversation || !conversation.participants.some(p => p.toString() === userId.toString())) {
    return res.status(403).json({
      status: 'fail',
      message: 'You are not a participant in this conversation'
    });
  }

  try {
    await message.addReaction(userId, emoji);

    res.status(200).json({
      status: 'success',
      data: { message }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to add reaction'
    });
  }
};

// ========== REMOVE REACTION FROM MESSAGE ==========
exports.removeReaction = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;

  const message = await Message.findOne({
    _id: messageId,
    reactedBy: userId
  });

  if (!message) {
    return res.status(404).json({
      status: 'fail',
      message: 'Reaction not found or message does not exist'
    });
  }

  try {
    await message.removeReaction();

    res.status(200).json({
      status: 'success',
      message: 'Reaction removed'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to remove reaction'
    });
  }
};

// ========== FORWARD MESSAGE ==========
exports.forwardMessage = async (req, res) => {
  const { messageId } = req.params;
  const { targetConversationId } = req.body;
  const userId = req.user._id;

  if (!targetConversationId) {
    return res.status(400).json({
      status: 'fail',
      message: 'Target conversation ID is required'
    });
  }

  const originalMessage = await Message.findById(messageId);
  if (!originalMessage) {
    return res.status(404).json({
      status: 'fail',
      message: 'Message to forward not found'
    });
  }

  const sourceConversation = await verifyParticipant(originalMessage.conversation, userId);
  if (!sourceConversation) {
    return res.status(403).json({
      status: 'fail',
      message: 'You are not a participant in the source conversation'
    });
  }

  const targetConversation = await verifyParticipant(targetConversationId, userId);
  if (!targetConversation) {
    return res.status(403).json({
      status: 'fail',
      message: 'You are not a participant in the target conversation'
    });
  }

  try {
    const forwardedMessage = await originalMessage.forward(targetConversationId, userId);

    res.status(201).json({
      status: 'success',
      data: { message: forwardedMessage }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to forward message'
    });
  }
};