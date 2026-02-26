// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../utils/cloudinary');

const router = express.Router();

// Generate JWT token (keep this helper)
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'fallback-secret', {
    expiresIn: '30d',
  });
};

// Configure Cloudinary storage for profile pictures
const profilePictureStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'profile-pictures',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    transformation: [{ width: 400, height: 400, crop: 'fill' }]
  }
});

// Configure Cloudinary storage for cover photos
const coverPictureStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'cover-photos',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    transformation: [{ width: 1200, height: 400, crop: 'fill' }]
  }
});

const uploadProfilePicture = multer({
  storage: profilePictureStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
}).single('profilePicture');

const uploadCoverPicture = multer({
  storage: coverPictureStorage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
}).single('coverPicture');

// =============================================
// AUTH ENDPOINTS
// =============================================

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, name } = req.body;

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }]
    });

    if (existingUser) {
      const field = existingUser.email === email.toLowerCase() ? 'email' : 'username';
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
      });
    }

    const user = await User.create({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      name: name || username,
      profilePicture: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff&bold=true`
    });

    const token = generateToken(user._id);
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: userResponse
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/auth/login - UPDATED to accept email OR username
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Check if either email or username is provided
    const loginIdentifier = email || username;

    if (!loginIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email or username'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide password'
      });
    }

    console.log(`🔐 Login attempt with: ${loginIdentifier}`);

    // Find user by email OR username
    const user = await User.findOne({
      $or: [
        { email: loginIdentifier.toLowerCase() },
        { username: loginIdentifier.toLowerCase() }
      ]
    }).select('+password');

    if (!user) {
      console.log(`❌ User not found: ${loginIdentifier}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log(`❌ Invalid password for user: ${user.username}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    console.log(`✅ Login successful for: ${user.username} (${user.email})`);

    const token = generateToken(user._id);
    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userResponse
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/auth/me - Get authenticated user
router.get('/me', protect, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// PUT /api/auth/profile - Update profile
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, bio, profilePicture, coverPicture } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (bio !== undefined) updates.bio = bio;
    if (profilePicture !== undefined) updates.profilePicture = profilePicture;
    if (coverPicture !== undefined) updates.coverPicture = coverPicture;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============================================
// PROFILE PICTURE UPLOADS
// =============================================

/**
 * @route   POST /api/auth/profile/picture
 * @desc    Upload profile picture
 * @access  Private
 */
router.post('/profile/picture', protect, uploadProfilePicture, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profilePicture: req.file.path },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      user
    });
  } catch (error) {
    console.error('Upload profile picture error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/auth/profile/cover
 * @desc    Upload cover picture
 * @access  Private
 */
router.post('/profile/cover', protect, uploadCoverPicture, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { coverPicture: req.file.path },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Cover picture updated successfully',
      user
    });
  } catch (error) {
    console.error('Upload cover picture error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;