// routes/passwordReset.js
const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const { sendPasswordResetEmail, sendPasswordResetSMS } = require('../services/notificationService');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting to prevent abuse
const resetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3,
    message: { success: false, message: 'Too many password reset attempts. Please try again later.' }
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send password reset link via email or SMS
 * @access  Public
 */
router.post('/forgot-password', resetLimiter, async (req, res) => {
    try {
        const { email, phoneNumber, phoneCountryCode, method } = req.body;

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
            user = await User.findOne({ email: email.toLowerCase() });
        } else {
            if (!phoneNumber || !phoneCountryCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Phone number and country code are required'
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

        // Generate reset token
        const resetToken = user.generatePasswordResetToken();
        await user.save({ validateBeforeSave: false });

        // Send reset link
        if (method === 'email') {
            await sendPasswordResetEmail(user, resetToken);
        } else {
            await sendPasswordResetSMS(user, resetToken);
        }

        res.json({
            success: true,
            message: `Reset link sent to your ${method === 'email' ? 'email' : 'phone'}`
        });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send reset link'
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

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
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
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token'
            });
        }

        // Update password
        user.password = password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();

        // Generate new JWT token for auto-login
        const jwtToken = require('jsonwebtoken').sign(
            { id: user._id },
            process.env.JWT_SECRET || 'fallback-secret',
            { expiresIn: '30d' }
        );

        const userResponse = user.toObject();
        delete userResponse.password;

        res.json({
            success: true,
            message: 'Password reset successful',
            token: jwtToken,
            user: userResponse
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset password'
        });
    }
});

/**
 * @route   GET /api/auth/verify-token/:token
 * @desc    Verify if reset token is valid
 * @access  Public
 */
router.get('/verify-token/:token', async (req, res) => {
    try {
        const { token } = req.params;

        const hashedToken = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpire: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        res.json({
            success: true,
            message: 'Token is valid'
        });

    } catch (error) {
        console.error('Verify token error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify token'
        });
    }
});

module.exports = router;