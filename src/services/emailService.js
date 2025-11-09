/**
 * Email Service
 * Supports multiple email providers with console fallback for development
 * Currently supports: Mailtrap (SMTP), Console (development)
 */

const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.provider = 'console'; // Default to console for development
    this.initializeTransporter();
  }

  /**
   * Initialize email transporter based on environment
   */
  initializeTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;

    // If Mailtrap or other SMTP is configured, use it
    if (smtpHost && smtpUser && smtpPassword) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort) || 587,
        secure: (smtpPort == 465), // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPassword
        }
      });
      this.provider = 'smtp';
      logger.info(`✅ Email service initialized with SMTP provider: ${smtpHost}`);
    } else {
      // Fallback to console for development
      this.transporter = nodemailer.createTransport({
        streamTransport: true,
        newline: 'unix',
        buffer: true
      });
      this.provider = 'console';
      logger.info('✅ Email service initialized with CONSOLE provider (development)');
    }
  }

  /**
   * Send email verification link to user
   * @param {Object} params
   * @param {String} params.email - User email
   * @param {String} params.firstName - User first name
   * @param {String} params.companyName - Company name
   * @param {String} params.verificationToken - JWT verification token
   * @param {String} params.verificationUrl - Full verification URL
   */
  async sendVerificationEmail({ email, firstName, companyName, verificationToken, verificationUrl }) {
    try {
      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: email,
        subject: `Vérifiez votre adresse email - ${companyName}`,
        html: this.getVerificationEmailTemplate({
          firstName,
          companyName,
          verificationUrl,
          verificationToken
        })
      };

      // Send email
      const result = await this.transporter.sendMail(mailOptions);

      // Log in development
      if (this.provider === 'console') {
        logger.warn('📧 [DEVELOPMENT] Email would be sent (check output below):');
        logger.warn('─'.repeat(80));
        logger.warn(`TO: ${email}`);
        logger.warn(`FROM: ${mailOptions.from}`);
        logger.warn(`SUBJECT: ${mailOptions.subject}`);
        logger.warn('─'.repeat(80));
        logger.warn('VERIFICATION LINK:');
        logger.warn(verificationUrl);
        logger.warn('─'.repeat(80));
        logger.warn('VERIFICATION TOKEN:');
        logger.warn(verificationToken);
        logger.warn('─'.repeat(80));
      }

      logger.info(`✅ Verification email sent to ${email}`, {
        provider: this.provider,
        companyName
      });

      return {
        success: true,
        provider: this.provider,
        message: 'Verification email sent successfully'
      };
    } catch (error) {
      logger.error(`❌ Failed to send verification email to ${email}:`, error);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  /**
   * Get HTML template for verification email
   */
  getVerificationEmailTemplate({ firstName, companyName, verificationUrl, verificationToken }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f9f9f9;
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 30px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .content {
              background-color: white;
              padding: 30px;
              border-radius: 0 0 8px 8px;
            }
            .button {
              display: inline-block;
              background-color: #667eea;
              color: white !important;
              padding: 12px 30px;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
              margin: 20px 0;
            }
            .button:hover {
              background-color: #764ba2;
            }
            .token-box {
              background-color: #f0f0f0;
              padding: 15px;
              border-radius: 4px;
              font-family: monospace;
              word-break: break-all;
              font-size: 12px;
              margin: 15px 0;
            }
            .footer {
              color: #999;
              font-size: 12px;
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #eee;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Bienvenue! 👋</h1>
              <p>Vérifiez votre adresse email pour accéder à ${companyName}</p>
            </div>

            <div class="content">
              <h2>Bonjour ${firstName || 'Utilisateur'},</h2>

              <p>Merci de vous être inscrit auprès de <strong>${companyName}</strong>.</p>

              <p>Pour accéder à votre compte et commencer à utiliser notre plateforme, veuillez vérifier votre adresse email en cliquant sur le bouton ci-dessous:</p>

              <center>
                <a href="${verificationUrl}" class="button">Vérifier mon adresse email</a>
              </center>

              <p style="color: #999; font-size: 14px;">
                Si le bouton ci-dessus ne fonctionne pas, copiez et collez ce lien dans votre navigateur:
              </p>

              <div class="token-box">${verificationUrl}</div>

              <h3>Détails de sécurité:</h3>
              <ul>
                <li>✅ Ce lien de vérification expire dans 24 heures</li>
                <li>✅ N'oubliez pas de confirmer votre adresse email avant de vous connecter</li>
                <li>✅ Vous recevrez un email de confirmation une fois vérifié</li>
              </ul>

              <p style="color: #999;">
                <strong>Note:</strong> Si vous n'avez pas créé ce compte, veuillez ignorer cet email.
              </p>
            </div>

            <div class="footer">
              <p>© 2025 MedicalPro. Tous les droits réservés.</p>
              <p>Cet email a été envoyé à ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Send email confirmation (after successful verification)
   */
  async sendVerificationConfirmed({ email, firstName, companyName }) {
    try {
      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: email,
        subject: `Adresse email confirmée - ${companyName}`,
        html: this.getConfirmationEmailTemplate({ firstName, companyName })
      };

      await this.transporter.sendMail(mailOptions);

      logger.info(`✅ Confirmation email sent to ${email}`, {
        provider: this.provider,
        companyName
      });

      return { success: true };
    } catch (error) {
      logger.error(`❌ Failed to send confirmation email to ${email}:`, error);
      // Don't throw error for confirmation - user is already verified
      return { success: false, error: error.message };
    }
  }

  /**
   * Get HTML template for confirmation email
   */
  getConfirmationEmailTemplate({ firstName, companyName }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .header { background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .success-badge { text-align: center; font-size: 48px; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Adresse email confirmée! ✅</h1>
            </div>

            <div class="content">
              <div class="success-badge">✨</div>

              <h2>Bienvenue ${firstName || 'Utilisateur'}!</h2>

              <p>Votre adresse email a été vérifiée avec succès.</p>

              <p>Vous pouvez maintenant accéder à ${companyName} avec vos identifiants de connexion.</p>

              <p><strong>Prochaines étapes:</strong></p>
              <ul>
                <li>Connectez-vous avec vos identifiants</li>
                <li>Complétez votre profil si nécessaire</li>
                <li>Commencez à utiliser la plateforme</li>
              </ul>

              <p style="margin-top: 30px; color: #999;">
                Si vous avez des questions, n'hésitez pas à nous contacter.
              </p>
            </div>

            <div class="footer">
              <p>© 2025 MedicalPro. Tous les droits réservés.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}

// Export singleton instance
module.exports = new EmailService();
