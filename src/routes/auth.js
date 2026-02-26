// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../utils/cloudinary');
const crypto = require('crypto'); // Add this for random password generation

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

// =============================================
// GOOGLE OAUTH ENDPOINTS (NO SESSIONS - USING JWT)
// =============================================

/**
 * @route   GET /api/auth/google
 * @desc    Redirect to Google OAuth (popup flow)
 * @access  Public
 */
router.get('/google', (req, res) => {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent('profile email')}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.redirect(googleAuthUrl);
});

/**
 * @route   GET /api/auth/google/callback
 * @desc    Google OAuth callback (popup flow)
 * @access  Public
 */
router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=google-auth-failed`);
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Google token error:', tokenData);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=google-auth-failed`);
    }

    // Get user info from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const profile = await userResponse.json();

    // Find or create user
    let user = await User.findOne({
      $or: [
        { googleId: profile.sub },
        { email: profile.email }
      ]
    });

    if (!user) {
      // Create new user
      const username = profile.email.split('@')[0] + Math.floor(Math.random() * 1000);

      user = new User({
        googleId: profile.sub,
        username: username.toLowerCase(),
        email: profile.email.toLowerCase(),
        name: profile.name,
        profilePicture: profile.picture,
        isGoogleUser: true,
        emailVerified: true,
        password: crypto.randomBytes(20).toString('hex')
      });

      await user.save();
    } else if (!user.googleId) {
      // Link Google account to existing user
      user.googleId = profile.sub;
      user.isGoogleUser = true;
      await user.save();
    }

    // Generate JWT token
    const jwtToken = generateToken(user._id);

    // Prepare user response (remove password)
    const userData = user.toObject();
    delete userData.password;

    // Redirect back to frontend with token (for popup to catch)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // In your auth.js callback, update the HTML response

    res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>Google Login Success</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }
      .container {
        text-align: center;
        padding: 2rem;
        background: rgba(255,255,255,0.1);
        border-radius: 1rem;
        backdrop-filter: blur(10px);
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>Login Successful! 🎉</h2>
      <p>Redirecting you back to Pulse...</p>
    </div>
    <script>
      (function() {
        try {
          // Try multiple methods to communicate with parent
          if (window.opener) {
            window.opener.postMessage({
              type: 'GOOGLE_LOGIN_SUCCESS',
              token: '${jwtToken}',
              user: ${JSON.stringify(userData)}
            }, '${frontendUrl}');
            
            setTimeout(() => {
              window.close();
            }, 1500);
          } else if (window.parent !== window) {
            window.parent.postMessage({
              type: 'GOOGLE_LOGIN_SUCCESS',
              token: '${jwtToken}',
              user: ${JSON.stringify(userData)}
            }, '${frontendUrl}');
          } else {
            // Fallback: redirect to callback page
            window.location.href = '${frontendUrl}/google-callback?token=${jwtToken}';
          }
        } catch (e) {
          console.error('Error in postMessage:', e);
          window.location.href = '${frontendUrl}/google-callback?token=${jwtToken}';
        }
      })();
    </script>
  </body>
  </html>
`);

  } catch (error) {
    console.error('Google callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=server-error`);
  }
});

/**
 * @route   POST /api/auth/google/token
 * @desc    Exchange Google access token for JWT (for mobile apps)
 * @access  Public
 */
router.post('/google/token', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Verify token with Google
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token'
      });
    }

    const profile = await response.json();

    // Find or create user
    let user = await User.findOne({
      $or: [
        { googleId: profile.sub },
        { email: profile.email }
      ]
    });

    if (!user) {
      const username = profile.email.split('@')[0] + Math.floor(Math.random() * 1000);

      user = new User({
        googleId: profile.sub,
        username: username.toLowerCase(),
        email: profile.email.toLowerCase(),
        name: profile.name,
        profilePicture: profile.picture,
        isGoogleUser: true,
        emailVerified: true,
        password: crypto.randomBytes(20).toString('hex')
      });

      await user.save();
    } else if (!user.googleId) {
      user.googleId = profile.sub;
      user.isGoogleUser = true;
      await user.save();
    }

    // Generate JWT
    const jwtToken = generateToken(user._id);

    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({
      success: true,
      message: 'Google authentication successful',
      token: jwtToken,
      user: userResponse
    });

  } catch (error) {
    console.error('Google token exchange error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to authenticate with Google'
    });
  }
});

module.exports = router;