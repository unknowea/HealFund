import nodemailer from 'nodemailer';

// Create transporter based on environment variables
const createTransporter = () => {
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST;
  const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10);
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  const service = process.env.EMAIL_SERVICE;

  if (service) {
    return nodemailer.createTransport({
      service,
      auth: { user, pass },
    });
  }

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  return null;
};

const transporter = createTransporter();

/**
 * Send an OTP verification email to the user
 * @param {string} toEmail - Recipient email address
 * @param {string} otp - 6-digit OTP code
 * @param {string} purpose - Purpose of OTP ('signup', 'login', 'reset-password')
 */
export const sendOtpEmail = async (toEmail, otp, purpose = 'signup') => {
  if (!transporter) {
    throw new Error(
      'Email delivery is not configured. Set EMAIL_SERVICE, EMAIL_USER, and EMAIL_PASS in backend/.env.'
    );
  }

  const senderAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'HealFundET@gmail.com';

  let purposeTitle = 'Account Verification';
  let purposeDescription = 'Thank you for choosing HealFund. Use the One-Time Password (OTP) below to verify your email address.';

  if (purpose === 'login') {
    purposeTitle = 'Login Verification';
    purposeDescription = 'A login request was initiated for your HealFund account. Use the code below to complete your login.';
  } else if (purpose === 'reset-password') {
    purposeTitle = 'Password Reset';
    purposeDescription = 'A password reset request was received for your HealFund account. Use the code below to reset your password.';
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${purposeTitle} - HealFund</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #f0f8f4; margin: 0; padding: 20px; color: #1e2b3c; }
        .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.08); border-top: 5px solid #078930; }
        .header { background: #f8fdfa; padding: 24px 30px; text-align: center; border-bottom: 1px solid #e8f4ec; }
        .logo { font-size: 24px; font-weight: bold; color: #0d5a3d; }
        .logo span { color: #078930; }
        .body-content { padding: 32px 30px; text-align: center; }
        .title { font-size: 20px; font-weight: 700; color: #0d5a3d; margin-bottom: 12px; }
        .desc { font-size: 15px; color: #4a5a6e; line-height: 1.6; margin-bottom: 24px; }
        .otp-box { background: #edf9f3; border: 2px dashed #078930; border-radius: 12px; padding: 18px 24px; display: inline-block; margin-bottom: 24px; }
        .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #078930; font-family: monospace; }
        .expiry { font-size: 13px; color: #e65100; font-weight: 600; margin-bottom: 20px; }
        .warning { font-size: 12px; color: #7a8a9e; border-top: 1px solid #eef2f6; padding-top: 18px; line-height: 1.5; }
        .footer { background: #f4f9f6; padding: 16px 30px; text-align: center; font-size: 12px; color: #7a8a9e; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🌿 Heal<span>Fund</span></div>
        </div>
        <div class="body-content">
          <div class="title">${purposeTitle}</div>
          <div class="desc">${purposeDescription}</div>
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
          </div>
          <div class="expiry">⏱ This code is valid for 10 minutes.</div>
          <div class="warning">
            <strong>Security Notice:</strong> Never share this OTP with anyone. HealFund staff will never ask for your verification code. If you did not request this, please ignore this email.
          </div>
        </div>
        <div class="footer">
          © 2026 HealFund · Healthcare & Financial Assistance Support
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `HealFund ${purposeTitle}\n\nYour One-Time Password (OTP) is: ${otp}\n\nThis code is valid for 10 minutes.\nNever share this code with anyone.`;

  const mailOptions = {
    from: `"HealFund" <${senderAddress}>`,
    to: toEmail,
    subject: `${otp} is your HealFund verification code`,
    text: textContent,
    html: htmlContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send email:', error);
    throw new Error('Unable to send the verification email. Check the email configuration and try again.');
  }
};

export default transporter;
