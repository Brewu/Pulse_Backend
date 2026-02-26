// routes/passwordReset.js
const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const { sendPasswordResetEmail, sendPasswordResetSMS } = require('../services/notificationService');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken'); // Add this import

const router = express.Router();

// Rate limiting to prevent abuse
const resetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // Limit each IP to 3 requests per windowMs
    message: { success: false, message: 'Too many password reset attempts. Please try again later.' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Stricter rate limit for token verification (prevent brute force)
const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per 15 minutes
    message: { success: false, message: 'Too many verification attempts. Please try again later.' }
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send password reset link via email or SMS
 * @access  Public
 */
router.post('/forgot-password', resetLimiter, async (req, res) => {
    try {
        const { email, phoneNumber, phoneCountryCode, method } = req.body;

        // Validate input
        if (!method || (method !== 'email' && method !== 'sms')) {
            return res.status(400).json({
                success: false,
                message: 'Please specify a valid method: email or sms'
            });
        }

        // Find user by email or phone
        let user;
        if (method === 'email') {
            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: 'Email is required'
                });
            }
            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please provide a valid email address'
                });
            }
            user = await User.findOne({ email: email.toLowerCase() });
        } else {
            if (!phoneNumber || !phoneCountryCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Phone number and country code are required'
                });
            }
            // Validate phone number format (basic)
            const phoneRegex = /^\d{10,15}$/;
            if (!phoneRegex.test(phoneNumber)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please provide a valid phone number'
                });
            }
            user = await User.findOne({
                phoneNumber: phoneNumber,
                phoneCountryCode: phoneCountryCode
            });
        }

        if (!user) {
            // For security, don't reveal that user doesn't exist
            return res.json({
                success: true,
                message: 'If an account exists, you will receive a reset link'
            });
        }

        // Check if user has a password (might be Google-only user)
        if (!user.password && user.isGoogleUser) {
            return res.status(400).json({
                success: false,
                message: 'This account uses Google Sign-In. Please log in with Google.'
            });
        }

        // Generate reset token
        const resetToken = user.generatePasswordResetToken();
        await user.save({ validateBeforeSave: false });

        // Send reset link with error handling
        try {
            if (method === 'email') {
                await sendPasswordResetEmail(user, resetToken);
            } else {
                await sendPasswordResetSMS(user, resetToken);
            }
        } catch (sendError) {
            // If sending fails, clear the token
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            await user.save({ validateBeforeSave: false });

            console.error('Failed to send reset link:', sendError);
            return res.status(500).json({
                success: false,
                message: 'Failed to send reset link. Please try again later.'
            });
        }

        res.json({
            success: true,
            message: `Reset link sent to your ${method === 'email' ? 'email' : 'phone'}`
        });

    } catch (error) {
        console.error('❌ Forgot password error:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred. Please try again later.'
        });
    }
});

/**
 * @route   POST /api/auth/reset-password/:token
 * @desc    Reset password with token
 * @access  Public
 */
router.post('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { password, confirmPassword } = req.body;

        // Validate input
        if (!password || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Please provide password and confirm password'
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Passwords do not match'
            });
        }

        // Password strength validation
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
            });
        }

        // Optional: Add more password strength requirements
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);

        if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
            });
        }

        // Hash token
        const hashedToken = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        // Find user with valid token
        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpire: { $gt: Date.now() }
        }).select('+password');

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token'
            });
        }

        // Check if new password is same as old password
        const isSamePassword = await user.comparePassword(password);
        if (isSamePassword) {
            return res.status(400).json({
                success: false,
                message: 'New password must be different from your current password'
            });
        }

        // Update password
        user.password = password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();

        // Log the password change (optional)
        console.log(`✅ Password reset successful for user: ${user.email}`);

        // Generate new JWT token for auto-login
        const jwtToken = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET || 'fallback-secret',
            { expiresIn: '30d' }
        );

        const userResponse = user.toObject();
        delete userResponse.password;
        delete userResponse.resetPasswordToken;
        delete userResponse.resetPasswordExpire;

        res.json({
            success: true,
            message: 'Password reset successful',
            token: jwtToken,
            user: userResponse
        });

    } catch (error) {
        console.error('❌ Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset password. Please try again later.'
        });
    }
});

/**
 * @route   GET /api/auth/verify-token/:token
 * @desc    Verify if reset token is valid
 * @access  Public
 */
router.get('/verify-token/:token', verifyLimiter, async (req, res) => {
    try {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Token is required'
            });
        }

        const hashedToken = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpire: { $gt: Date.now() }
        }).select('email phoneNumber');

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        res.json({
            success: true,
            message: 'Token is valid',
            data: {
                email: user.email ? user.email.replace(/(.{2})(.*)(?=@)/, '$1***') : undefined, // Partially hide email
                phoneNumber: user.phoneNumber ? '***' + user.phoneNumber.slice(-4) : undefined // Show last 4 digits
            }
        });

    } catch (error) {
        console.error('❌ Verify token error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify token'
        });
    }
});

module.exports = router;