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
    this.testModeEnabled = process.env.TEST_MODE_EMAIL === 'true';
    this.testEmailAddress = process.env.TEST_EMAIL_ADDRESS || 'dev@medicalpro.test';
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

    console.log('[EmailService] Initializing with:', {
      smtpHost,
      smtpPort,
      smtpUser: smtpUser ? 'SET' : 'EMPTY',
      smtpPassword: smtpPassword ? 'SET' : 'EMPTY',
      testMode: this.testModeEnabled,
      testEmail: this.testModeEnabled ? this.testEmailAddress : 'N/A'
    });

    // If SMTP host is configured, use it (with or without authentication)
    if (smtpHost) {
      const transportConfig = {
        host: smtpHost,
        port: parseInt(smtpPort) || 587,
        secure: (smtpPort == 465), // true for 465, false for other ports
        ignoreSTARTTLS: true
      };

      // Only add auth if credentials are provided (not needed for Mailhog)
      if (smtpUser || smtpPassword) {
        transportConfig.auth = {
          user: smtpUser || '',
          pass: smtpPassword || ''
        };
      }

      this.transporter = nodemailer.createTransport(transportConfig);
      this.provider = 'smtp';
      console.log('[EmailService] Config:', JSON.stringify(transportConfig, null, 2));
      logger.info(`✅ Email service initialized with SMTP provider: ${smtpHost}:${smtpPort}`);

      if (this.testModeEnabled) {
        logger.warn(`🧪 TEST MODE ENABLED - All emails will be sent to: ${this.testEmailAddress}`);
      }
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
   * Get recipient email considering test mode
   * In test mode, all emails go to TEST_EMAIL_ADDRESS
   * but the original email is preserved in metadata
   */
  getRecipientEmail(originalEmail) {
    if (this.testModeEnabled) {
      return this.testEmailAddress;
    }
    return originalEmail;
  }

  /**
   * Get email subject with test prefix
   * In test mode, adds [TEST - VERIFICATION] prefix
   */
  getEmailSubject(baseSubject, emailType = 'GENERIC') {
    if (this.testModeEnabled) {
      return `[TEST - ${emailType}] ${baseSubject}`;
    }
    return baseSubject;
  }

  /**
   * Prepare email content with test mode information
   * Adds info box showing original recipient if in test mode
   */
  wrapEmailContentWithTestInfo(htmlContent, originalEmail) {
    if (!this.testModeEnabled) {
      return htmlContent;
    }

    const testInfoBox = `
      <div style="background-color: #fff3cd; border: 2px solid #ffc107; border-radius: 4px; padding: 15px; margin-bottom: 20px;">
        <p style="margin: 0; color: #856404; font-weight: bold;">🧪 MODE TEST ACTIVÉ</p>
        <p style="margin: 5px 0 0 0; color: #856404; font-size: 12px;">
          Email original: <code style="background-color: #ffe69c; padding: 2px 4px; border-radius: 2px;">${originalEmail}</code>
        </p>
        <p style="margin: 5px 0 0 0; color: #856404; font-size: 12px;">
          En production, cet email serait envoyé au destinataire réel.
        </p>
      </div>
    `;

    return testInfoBox + htmlContent;
  }

  /**
   * Send email verification link to user
   * @param {Object} params
   * @param {String} params.email - User email
   * @param {String} params.firstName - User first name
   * @param {String} params.companyName - Company name
   * @param {String} params.verificationToken - JWT verification token
   * @param {String} params.verificationUrl - Full verification URL
   * @param {String} params.region - User region (FR, ES, etc.)
   */
  async sendVerificationEmail({ email, firstName, companyName, verificationToken, verificationUrl, region = 'FR' }) {
    try {
      console.log('[EmailService] Attempting to send verification email:', {
        email,
        provider: this.provider,
        testMode: this.testModeEnabled
      });

      // Get recipient email (test mode redirects to TEST_EMAIL_ADDRESS)
      const recipientEmail = this.getRecipientEmail(email);

      // Get email template based on region
      let htmlContent = this.getVerificationEmailTemplate(region.toUpperCase(), {
        email,
        firstName,
        companyName,
        verificationUrl,
        verificationToken
      });

      // Wrap with test info if in test mode
      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(`Vérifiez votre adresse email - ${companyName}`, 'VERIFICATION'),
        html: htmlContent
      };

      console.log('[EmailService] Mail options prepared:', {
        from: mailOptions.from,
        to: mailOptions.to,
        originalEmail: email,
        testMode: this.testModeEnabled
      });

      // Send email
      const result = await this.transporter.sendMail(mailOptions);

      console.log('[EmailService] Email sent successfully:', { messageId: result.messageId });

      // Log in development
      if (this.provider === 'console') {
        logger.warn('📧 [DEVELOPMENT] Email would be sent (check output below):');
        logger.warn('─'.repeat(80));
        logger.warn(`TO: ${email}`);
        if (this.testModeEnabled) {
          logger.warn(`REDIRECTED TO (TEST): ${recipientEmail}`);
        }
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
        companyName,
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      });

      return {
        success: true,
        provider: this.provider,
        message: 'Verification email sent successfully',
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      };
    } catch (error) {
      console.error('[EmailService] Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      logger.error(`❌ Failed to send verification email to ${email}:`, error.message);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  /**
   * Get HTML template for verification email based on region
   * @param {String} region - User region (FR, ES)
   * @param {Object} params - Template parameters
   */
  getVerificationEmailTemplate(region = 'FR', { email, firstName, companyName, verificationUrl, verificationToken }) {
    region = region.toUpperCase();

    if (region === 'ES') {
      return this.getVerificationEmailTemplateES({ email, firstName, companyName, verificationUrl, verificationToken });
    }

    // Default to French
    return this.getVerificationEmailTemplateFR({ email, firstName, companyName, verificationUrl, verificationToken });
  }

  /**
   * Get HTML template for verification email (FRENCH)
   */
  getVerificationEmailTemplateFR({ email, firstName, companyName, verificationUrl, verificationToken }) {
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
   * Get HTML template for verification email (SPANISH)
   */
  getVerificationEmailTemplateES({ email, firstName, companyName, verificationUrl, verificationToken }) {
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
              <h1>¡Bienvenido! 👋</h1>
              <p>Verifica tu dirección de correo para acceder a ${companyName}</p>
            </div>

            <div class="content">
              <h2>Hola ${firstName || 'Usuario'},</h2>

              <p>Gracias por registrarte en <strong>${companyName}</strong>.</p>

              <p>Para acceder a tu cuenta y comenzar a usar nuestra plataforma, verifica tu dirección de correo haciendo clic en el botón de abajo:</p>

              <center>
                <a href="${verificationUrl}" class="button">Verificar mi dirección de correo</a>
              </center>

              <p style="color: #999; font-size: 14px;">
                Si el botón de arriba no funciona, copia y pega este enlace en tu navegador:
              </p>

              <div class="token-box">${verificationUrl}</div>

              <h3>Detalles de seguridad:</h3>
              <ul>
                <li>✅ Este enlace de verificación caduca en 24 horas</li>
                <li>✅ No olvides confirmar tu dirección de correo antes de iniciar sesión</li>
                <li>✅ Recibirás un correo de confirmación una vez verificado</li>
              </ul>

              <p style="color: #999;">
                <strong>Nota:</strong> Si no creaste esta cuenta, ignora este correo.
              </p>
            </div>

            <div class="footer">
              <p>© 2025 MedicalPro. Todos los derechos reservados.</p>
              <p>Este correo fue enviado a ${email}</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Send email confirmation (after successful verification)
   * @param {Object} params
   * @param {String} params.email - User email
   * @param {String} params.firstName - User first name
   * @param {String} params.companyName - Company name
   * @param {String} params.region - User region (FR, ES, etc.)
   */
  async sendVerificationConfirmed({ email, firstName, companyName, region = 'FR' }) {
    try {
      // Get recipient email (test mode redirects to TEST_EMAIL_ADDRESS)
      const recipientEmail = this.getRecipientEmail(email);

      // Get email template based on region
      let htmlContent = this.getConfirmationEmailTemplate(region.toUpperCase(), { firstName, companyName });

      // Wrap with test info if in test mode
      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(`Adresse email confirmée - ${companyName}`, 'CONFIRMATION'),
        html: htmlContent
      };

      await this.transporter.sendMail(mailOptions);

      logger.info(`✅ Confirmation email sent to ${email}`, {
        provider: this.provider,
        companyName,
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      });

      return {
        success: true,
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      };
    } catch (error) {
      logger.error(`❌ Failed to send confirmation email to ${email}:`, error);
      // Don't throw error for confirmation - user is already verified
      return { success: false, error: error.message };
    }
  }

  /**
   * Get HTML template for confirmation email based on region
   * @param {String} region - User region (FR, ES)
   * @param {Object} params - Template parameters
   */
  getConfirmationEmailTemplate(region = 'FR', { firstName, companyName }) {
    region = region.toUpperCase();

    if (region === 'ES') {
      return this.getConfirmationEmailTemplateES({ firstName, companyName });
    }

    // Default to French
    return this.getConfirmationEmailTemplateFR({ firstName, companyName });
  }

  /**
   * Get HTML template for confirmation email (FRENCH)
   */
  getConfirmationEmailTemplateFR({ firstName, companyName }) {
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

  /**
   * Get HTML template for confirmation email (SPANISH)
   */
  getConfirmationEmailTemplateES({ firstName, companyName }) {
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
              <h1>¡Dirección de correo confirmada! ✅</h1>
            </div>

            <div class="content">
              <div class="success-badge">✨</div>

              <h2>¡Bienvenido ${firstName || 'Usuario'}!</h2>

              <p>Tu dirección de correo ha sido verificada exitosamente.</p>

              <p>Ahora puedes acceder a ${companyName} con tus credenciales de inicio de sesión.</p>

              <p><strong>Próximos pasos:</strong></p>
              <ul>
                <li>Inicia sesión con tus credenciales</li>
                <li>Completa tu perfil si es necesario</li>
                <li>Comienza a usar la plataforma</li>
              </ul>

              <p style="margin-top: 30px; color: #999;">
                Si tienes preguntas, no dudes en contactarnos.
              </p>
            </div>

            <div class="footer">
              <p>© 2025 MedicalPro. Todos los derechos reservados.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}

// Export singleton instance
module.exports = new EmailService();
