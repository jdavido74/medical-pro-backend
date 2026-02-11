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
        secure: (smtpPort == 465) // true for 465, false for other ports (STARTTLS used on 587)
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
      const safeConfig = { ...transportConfig, auth: transportConfig.auth ? { user: transportConfig.auth.user, pass: '***' } : undefined };
      console.log('[EmailService] Config:', JSON.stringify(safeConfig, null, 2));
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
   * Generate email header HTML with optional clinic logo
   * @param {Object} params
   * @param {String} params.title - Header title text
   * @param {String} params.subtitle - Optional subtitle text
   * @param {String} params.logoUrl - Optional full URL to clinic logo
   * @param {String} params.gradientColors - CSS gradient colors (default: '#667eea, #764ba2')
   */
  getEmailHeader({ title, subtitle, logoUrl, gradientColors = '#667eea, #764ba2' }) {
    const logoHtml = logoUrl
      ? `<img src="${logoUrl}" alt="" style="max-height: 60px; max-width: 200px; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto;" />`
      : '';
    return `
      <div class="header" style="background: linear-gradient(135deg, ${gradientColors}); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        ${logoHtml}
        <h1 style="margin: 0;">${title}</h1>
        ${subtitle ? `<p style="margin: 10px 0 0 0; opacity: 0.9;">${subtitle}</p>` : ''}
      </div>`;
  }

  /**
   * Fetch clinic logo URL from medical_facilities table
   * @param {Object} clinicDb - Sequelize clinic database connection
   * @returns {String|null} Full logo URL or null
   */
  async getClinicLogoUrl(clinicDb) {
    try {
      const [rows] = await clinicDb.query(
        'SELECT logo_url FROM medical_facilities LIMIT 1'
      );
      if (rows[0]?.logo_url) {
        const baseUrl = process.env.BACKEND_URL || process.env.APP_URL || 'http://localhost:3001';
        return `${baseUrl}${rows[0].logo_url}`;
      }
    } catch (e) {
      // Silently ignore - logo is optional
    }
    return null;
  }

  /**
   * Send email verification link to user
   * @param {Object} params
   * @param {String} params.email - User email
   * @param {String} params.firstName - User first name
   * @param {String} params.companyName - Company name
   * @param {String} params.verificationToken - JWT verification token
   * @param {String} params.verificationUrl - Full verification URL
   * @param {String} params.language - Language code (fr, en, es)
   * @param {String} params.logoUrl - Optional full URL to clinic logo
   */
  async sendVerificationEmail({ email, firstName, companyName, verificationToken, verificationUrl, language = 'fr', logoUrl = null }) {
    try {
      console.log('[EmailService] Attempting to send verification email:', {
        email,
        provider: this.provider,
        testMode: this.testModeEnabled
      });

      // Get recipient email (test mode redirects to TEST_EMAIL_ADDRESS)
      const recipientEmail = this.getRecipientEmail(email);

      // Get email template based on language
      let htmlContent = this.getVerificationEmailTemplate(language, {
        email,
        firstName,
        companyName,
        verificationUrl,
        verificationToken,
        logoUrl
      });

      // Wrap with test info if in test mode
      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const subjects = {
        fr: `Vérifiez votre adresse email - ${companyName}`,
        en: `Verify your email address - ${companyName}`,
        es: `Verifique su dirección de correo - ${companyName}`
      };

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(subjects[language] || subjects.fr, 'VERIFICATION'),
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
   * Get HTML template for verification email based on language
   * @param {String} language - Language code (fr, en, es)
   * @param {Object} params - Template parameters
   */
  getVerificationEmailTemplate(language, params) {
    const templates = {
      fr: this.getVerificationEmailTemplateFR,
      en: this.getVerificationEmailTemplateEN,
      es: this.getVerificationEmailTemplateES
    };

    const templateFn = templates[language] || templates.fr;
    return templateFn.call(this, params);
  }

  /**
   * Get HTML template for verification email (FRENCH)
   */
  getVerificationEmailTemplateFR({ email, firstName, companyName, verificationUrl, verificationToken, logoUrl }) {
    const header = this.getEmailHeader({
      title: 'Bienvenue!',
      subtitle: `Vérifiez votre adresse email pour accéder à ${companyName}`,
      logoUrl,
      gradientColors: '#667eea, #764ba2'
    });

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
            ${header}

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
  getVerificationEmailTemplateES({ email, firstName, companyName, verificationUrl, verificationToken, logoUrl }) {
    const header = this.getEmailHeader({
      title: '¡Bienvenido!',
      subtitle: `Verifica tu dirección de correo para acceder a ${companyName}`,
      logoUrl,
      gradientColors: '#667eea, #764ba2'
    });

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
            ${header}

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
   * Get HTML template for verification email (ENGLISH)
   */
  getVerificationEmailTemplateEN({ email, firstName, companyName, verificationUrl, verificationToken, logoUrl }) {
    const header = this.getEmailHeader({
      title: 'Welcome!',
      subtitle: `Verify your email address to access ${companyName}`,
      logoUrl,
      gradientColors: '#667eea, #764ba2'
    });

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
            ${header}

            <div class="content">
              <h2>Hello ${firstName || 'User'},</h2>

              <p>Thank you for registering with <strong>${companyName}</strong>.</p>

              <p>To access your account and start using our platform, please verify your email address by clicking the button below:</p>

              <center>
                <a href="${verificationUrl}" class="button">Verify my email address</a>
              </center>

              <p style="color: #999; font-size: 14px;">
                If the button above doesn't work, copy and paste this link into your browser:
              </p>

              <div class="token-box">${verificationUrl}</div>

              <h3>Security details:</h3>
              <ul>
                <li>This verification link expires in 24 hours</li>
                <li>Please confirm your email address before logging in</li>
                <li>You will receive a confirmation email once verified</li>
              </ul>

              <p style="color: #999;">
                <strong>Note:</strong> If you did not create this account, please ignore this email.
              </p>
            </div>

            <div class="footer">
              <p>&copy; 2025 MedicalPro. All rights reserved.</p>
              <p>This email was sent to ${email}</p>
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
   * @param {String} params.language - Language code (fr, en, es)
   */
  async sendVerificationConfirmed({ email, firstName, companyName, language = 'fr', logoUrl = null }) {
    try {
      // Get recipient email (test mode redirects to TEST_EMAIL_ADDRESS)
      const recipientEmail = this.getRecipientEmail(email);

      // Get email template based on language
      let htmlContent = this.getConfirmationEmailTemplate(language, { firstName, companyName, logoUrl });

      // Wrap with test info if in test mode
      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const subjects = {
        fr: `Adresse email confirmée - ${companyName}`,
        en: `Email address confirmed - ${companyName}`,
        es: `Dirección de correo confirmada - ${companyName}`
      };

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(subjects[language] || subjects.fr, 'CONFIRMATION'),
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
   * Get HTML template for confirmation email based on language
   * @param {String} language - Language code (fr, en, es)
   * @param {Object} params - Template parameters
   */
  getConfirmationEmailTemplate(language, params) {
    const templates = {
      fr: this.getConfirmationEmailTemplateFR,
      en: this.getConfirmationEmailTemplateEN,
      es: this.getConfirmationEmailTemplateES
    };

    const templateFn = templates[language] || templates.fr;
    return templateFn.call(this, params);
  }

  /**
   * Get HTML template for confirmation email (FRENCH)
   */
  getConfirmationEmailTemplateFR({ firstName, companyName, logoUrl }) {
    const header = this.getEmailHeader({
      title: 'Adresse email confirmée!',
      logoUrl,
      gradientColors: '#16a34a, #15803d'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .success-badge { text-align: center; font-size: 48px; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}

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
  getConfirmationEmailTemplateES({ firstName, companyName, logoUrl }) {
    const header = this.getEmailHeader({
      title: '¡Dirección de correo confirmada!',
      logoUrl,
      gradientColors: '#16a34a, #15803d'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .success-badge { text-align: center; font-size: 48px; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}

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

  /**
   * Get HTML template for confirmation email (ENGLISH)
   */
  getConfirmationEmailTemplateEN({ firstName, companyName, logoUrl }) {
    const header = this.getEmailHeader({
      title: 'Email address confirmed!',
      logoUrl,
      gradientColors: '#16a34a, #15803d'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .success-badge { text-align: center; font-size: 48px; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}

            <div class="content">
              <div class="success-badge">✨</div>

              <h2>Welcome ${firstName || 'User'}!</h2>

              <p>Your email address has been successfully verified.</p>

              <p>You can now access ${companyName} with your login credentials.</p>

              <p><strong>Next steps:</strong></p>
              <ul>
                <li>Log in with your credentials</li>
                <li>Complete your profile if needed</li>
                <li>Start using the platform</li>
              </ul>

              <p style="margin-top: 30px; color: #999;">
                If you have any questions, feel free to contact us.
              </p>
            </div>

            <div class="footer">
              <p>&copy; 2025 MedicalPro. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Send consent signing request email to patient
   * @param {Object} params
   * @param {String} params.email - Patient email
   * @param {String} params.patientName - Patient full name
   * @param {String} params.clinicName - Clinic name
   * @param {String} params.consentTitle - Consent document title
   * @param {String} params.signingUrl - Full signing URL with token
   * @param {String} params.expiresAt - Expiration date/time
   * @param {String} params.customMessage - Optional custom message from clinic
   * @param {String} params.language - Language code (fr, en, es)
   */
  async sendConsentSigningRequest({
    email,
    patientName,
    clinicName,
    consentTitle,
    signingUrl,
    expiresAt,
    customMessage,
    language = 'fr',
    logoUrl = null
  }) {
    try {
      const recipientEmail = this.getRecipientEmail(email);

      let htmlContent = this.getConsentSigningEmailTemplate(language, {
        email,
        patientName,
        clinicName,
        consentTitle,
        signingUrl,
        expiresAt,
        customMessage,
        logoUrl
      });

      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const subjects = {
        fr: `Document à signer - ${clinicName}`,
        en: `Document to sign - ${clinicName}`,
        es: `Documento para firmar - ${clinicName}`
      };

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(subjects[language] || subjects.fr, 'CONSENT'),
        html: htmlContent
      };

      const result = await this.transporter.sendMail(mailOptions);

      logger.info(`✅ Consent signing email sent to ${email}`, {
        provider: this.provider,
        clinicName,
        consentTitle,
        testMode: this.testModeEnabled
      });

      return {
        success: true,
        provider: this.provider,
        messageId: result.messageId,
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      };
    } catch (error) {
      logger.error(`❌ Failed to send consent signing email to ${email}:`, error);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  /**
   * Get consent signing email template based on language
   */
  getConsentSigningEmailTemplate(language, params) {
    const templates = {
      fr: this.getConsentSigningEmailTemplateFR,
      en: this.getConsentSigningEmailTemplateEN,
      es: this.getConsentSigningEmailTemplateES
    };

    const templateFn = templates[language] || templates.fr;
    return templateFn.call(this, params);
  }

  /**
   * Consent signing email template - FRENCH
   */
  getConsentSigningEmailTemplateFR({ email, patientName, clinicName, consentTitle, signingUrl, expiresAt, customMessage, logoUrl }) {
    const expiresDate = new Date(expiresAt).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const header = this.getEmailHeader({
      title: 'Document à signer',
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#3b82f6, #1d4ed8'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background-color: #3b82f6; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; font-size: 16px; }
            .document-box { background-color: #f0f7ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .custom-message { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
            .warning { color: #b91c1c; font-size: 14px; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}

            <div class="content">
              <h2>Bonjour ${patientName},</h2>

              <p><strong>${clinicName}</strong> vous demande de signer le document suivant :</p>

              <div class="document-box">
                <h3 style="margin: 0 0 10px 0; color: #1d4ed8;">${consentTitle}</h3>
                <p style="margin: 0; color: #666;">Ce document requiert votre signature électronique.</p>
              </div>

              ${customMessage ? `
              <div class="custom-message">
                <p style="margin: 0; font-style: italic;">"${customMessage}"</p>
              </div>
              ` : ''}

              <center>
                <a href="${signingUrl}" class="button">Consulter et signer le document</a>
              </center>

              <p style="color: #666; font-size: 14px; text-align: center;">
                Vous pouvez également copier ce lien dans votre navigateur :<br>
                <code style="word-break: break-all; font-size: 12px;">${signingUrl}</code>
              </p>

              <p class="warning">
                ⚠️ <strong>Important :</strong> Ce lien expire le ${expiresDate}.
                Veuillez signer le document avant cette date.
              </p>

              <h4>Comment ça marche ?</h4>
              <ol style="color: #666;">
                <li>Cliquez sur le bouton ci-dessus</li>
                <li>Lisez attentivement le document</li>
                <li>Signez avec votre doigt ou votre souris</li>
                <li>Validez votre signature</li>
              </ol>
            </div>

            <div class="footer">
              <p>© 2025 ${clinicName} - Propulsé par MedicalPro</p>
              <p>Cet email a été envoyé à ${email}</p>
              <p style="color: #999; font-size: 11px;">
                Si vous n'êtes pas patient de ${clinicName}, veuillez ignorer cet email.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Consent signing email template - ENGLISH
   */
  getConsentSigningEmailTemplateEN({ email, patientName, clinicName, consentTitle, signingUrl, expiresAt, customMessage, logoUrl }) {
    const expiresDate = new Date(expiresAt).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const header = this.getEmailHeader({
      title: 'Document to Sign',
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#3b82f6, #1d4ed8'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background-color: #3b82f6; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; font-size: 16px; }
            .document-box { background-color: #f0f7ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .custom-message { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
            .warning { color: #b91c1c; font-size: 14px; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}

            <div class="content">
              <h2>Hello ${patientName},</h2>

              <p><strong>${clinicName}</strong> is requesting your signature on the following document:</p>

              <div class="document-box">
                <h3 style="margin: 0 0 10px 0; color: #1d4ed8;">${consentTitle}</h3>
                <p style="margin: 0; color: #666;">This document requires your electronic signature.</p>
              </div>

              ${customMessage ? `
              <div class="custom-message">
                <p style="margin: 0; font-style: italic;">"${customMessage}"</p>
              </div>
              ` : ''}

              <center>
                <a href="${signingUrl}" class="button">Review and Sign Document</a>
              </center>

              <p style="color: #666; font-size: 14px; text-align: center;">
                You can also copy this link into your browser:<br>
                <code style="word-break: break-all; font-size: 12px;">${signingUrl}</code>
              </p>

              <p class="warning">
                ⚠️ <strong>Important:</strong> This link expires on ${expiresDate}.
                Please sign the document before this date.
              </p>

              <h4>How does it work?</h4>
              <ol style="color: #666;">
                <li>Click the button above</li>
                <li>Read the document carefully</li>
                <li>Sign with your finger or mouse</li>
                <li>Confirm your signature</li>
              </ol>
            </div>

            <div class="footer">
              <p>© 2025 ${clinicName} - Powered by MedicalPro</p>
              <p>This email was sent to ${email}</p>
              <p style="color: #999; font-size: 11px;">
                If you are not a patient of ${clinicName}, please ignore this email.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Consent signing email template - SPANISH
   */
  getConsentSigningEmailTemplateES({ email, patientName, clinicName, consentTitle, signingUrl, expiresAt, customMessage, logoUrl }) {
    const expiresDate = new Date(expiresAt).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const header = this.getEmailHeader({
      title: 'Documento para Firmar',
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#3b82f6, #1d4ed8'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background-color: #3b82f6; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; font-size: 16px; }
            .document-box { background-color: #f0f7ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .custom-message { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
            .warning { color: #b91c1c; font-size: 14px; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}

            <div class="content">
              <h2>Hola ${patientName},</h2>

              <p><strong>${clinicName}</strong> le solicita firmar el siguiente documento:</p>

              <div class="document-box">
                <h3 style="margin: 0 0 10px 0; color: #1d4ed8;">${consentTitle}</h3>
                <p style="margin: 0; color: #666;">Este documento requiere su firma electrónica.</p>
              </div>

              ${customMessage ? `
              <div class="custom-message">
                <p style="margin: 0; font-style: italic;">"${customMessage}"</p>
              </div>
              ` : ''}

              <center>
                <a href="${signingUrl}" class="button">Revisar y Firmar Documento</a>
              </center>

              <p style="color: #666; font-size: 14px; text-align: center;">
                También puede copiar este enlace en su navegador:<br>
                <code style="word-break: break-all; font-size: 12px;">${signingUrl}</code>
              </p>

              <p class="warning">
                ⚠️ <strong>Importante:</strong> Este enlace expira el ${expiresDate}.
                Por favor firme el documento antes de esta fecha.
              </p>

              <h4>¿Cómo funciona?</h4>
              <ol style="color: #666;">
                <li>Haga clic en el botón de arriba</li>
                <li>Lea el documento atentamente</li>
                <li>Firme con su dedo o ratón</li>
                <li>Confirme su firma</li>
              </ol>
            </div>

            <div class="footer">
              <p>© 2025 ${clinicName} - Impulsado por MedicalPro</p>
              <p>Este correo fue enviado a ${email}</p>
              <p style="color: #999; font-size: 11px;">
                Si no es paciente de ${clinicName}, por favor ignore este correo.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Send invitation email to new healthcare provider
   * @param {Object} params
   * @param {String} params.email - Provider email
   * @param {String} params.firstName - Provider first name
   * @param {String} params.lastName - Provider last name
   * @param {String} params.clinicName - Clinic name
   * @param {String} params.role - Provider role (physician, practitioner, etc.)
   * @param {String} params.invitationUrl - Full invitation URL with token
   * @param {String} params.expiresAt - Expiration date/time
   * @param {String} params.language - Language code (fr, en, es)
   */
  async sendInvitationEmail({
    email,
    firstName,
    lastName,
    clinicName,
    role,
    invitationUrl,
    expiresAt,
    language = 'fr',
    logoUrl = null
  }) {
    try {
      console.log('[EmailService] Sending invitation email:', {
        email,
        clinicName,
        role,
        language,
        testMode: this.testModeEnabled
      });

      const recipientEmail = this.getRecipientEmail(email);

      let htmlContent = this.getInvitationEmailTemplate(language, {
        email,
        firstName,
        lastName,
        clinicName,
        role,
        invitationUrl,
        expiresAt,
        logoUrl
      });

      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const subjects = {
        fr: `Invitation à rejoindre ${clinicName}`,
        en: `Invitation to join ${clinicName}`,
        es: `Invitación para unirse a ${clinicName}`
      };

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(subjects[language] || subjects.fr, 'INVITATION'),
        html: htmlContent
      };

      const result = await this.transporter.sendMail(mailOptions);

      // Log in development
      if (this.provider === 'console') {
        logger.warn('📧 [DEVELOPMENT] Invitation email would be sent:');
        logger.warn('─'.repeat(80));
        logger.warn(`TO: ${email}`);
        logger.warn(`FROM: ${mailOptions.from}`);
        logger.warn(`SUBJECT: ${mailOptions.subject}`);
        logger.warn('─'.repeat(80));
        logger.warn('INVITATION LINK:');
        logger.warn(invitationUrl);
        logger.warn('─'.repeat(80));
      }

      logger.info(`✅ Invitation email sent to ${email}`, {
        provider: this.provider,
        clinicName,
        role,
        testMode: this.testModeEnabled
      });

      return {
        success: true,
        provider: this.provider,
        messageId: result.messageId,
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      };
    } catch (error) {
      console.error('[EmailService] Invitation email error:', error);
      logger.error(`❌ Failed to send invitation email to ${email}:`, error);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  /**
   * Get invitation email template based on language
   */
  getInvitationEmailTemplate(language, params) {
    const templates = {
      fr: this.getInvitationEmailTemplateFR,
      en: this.getInvitationEmailTemplateEN,
      es: this.getInvitationEmailTemplateES
    };

    const templateFn = templates[language] || templates.fr;
    return templateFn.call(this, params);
  }

  /**
   * Invitation email template - FRENCH
   */
  getInvitationEmailTemplateFR({ email, firstName, lastName, clinicName, role, invitationUrl, expiresAt, logoUrl }) {
    const expiresDate = new Date(expiresAt).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const roleLabels = {
      physician: 'Médecin',
      practitioner: 'Praticien de santé',
      secretary: 'Secrétaire',
      admin: 'Administrateur',
      readonly: 'Consultant'
    };

    const header = this.getEmailHeader({
      title: "Bienvenue dans l'équipe !",
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#10b981, #059669'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background-color: #10b981; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; font-size: 16px; }
            .info-box { background-color: #f0fdf4; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .warning { color: #b91c1c; font-size: 14px; margin-top: 20px; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}

            <div class="content">
              <h2>Bonjour ${firstName} ${lastName},</h2>

              <p>Vous avez été invité(e) à rejoindre <strong>${clinicName}</strong> en tant que <strong>${roleLabels[role] || role}</strong>.</p>

              <div class="info-box">
                <h3 style="margin: 0 0 10px 0; color: #059669;">Vos informations de compte</h3>
                <p style="margin: 5px 0;"><strong>Email :</strong> ${email}</p>
                <p style="margin: 5px 0;"><strong>Rôle :</strong> ${roleLabels[role] || role}</p>
              </div>

              <p>Pour activer votre compte et définir votre mot de passe, cliquez sur le bouton ci-dessous :</p>

              <center>
                <a href="${invitationUrl}" class="button">Activer mon compte</a>
              </center>

              <p style="color: #666; font-size: 14px; text-align: center;">
                Vous pouvez également copier ce lien dans votre navigateur :<br>
                <code style="word-break: break-all; font-size: 12px;">${invitationUrl}</code>
              </p>

              <p class="warning">
                ⚠️ <strong>Important :</strong> Ce lien d'invitation expire le ${expiresDate}.
                Activez votre compte avant cette date.
              </p>

              <h4>Que se passe-t-il ensuite ?</h4>
              <ol style="color: #666;">
                <li>Cliquez sur le lien d'activation</li>
                <li>Définissez votre mot de passe sécurisé</li>
                <li>Connectez-vous avec vos identifiants</li>
                <li>Commencez à utiliser la plateforme</li>
              </ol>
            </div>

            <div class="footer">
              <p>© 2025 ${clinicName} - Propulsé par MedicalPro</p>
              <p>Cet email a été envoyé à ${email}</p>
              <p style="color: #999; font-size: 11px;">
                Si vous n'avez pas demandé cette invitation, veuillez ignorer cet email.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Invitation email template - ENGLISH
   */
  getInvitationEmailTemplateEN({ email, firstName, lastName, clinicName, role, invitationUrl, expiresAt, logoUrl }) {
    const expiresDate = new Date(expiresAt).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const roleLabels = {
      physician: 'Physician',
      practitioner: 'Healthcare Practitioner',
      secretary: 'Secretary',
      admin: 'Administrator',
      readonly: 'Read-only User'
    };

    const header = this.getEmailHeader({
      title: 'Welcome to the Team!',
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#10b981, #059669'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background-color: #10b981; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; font-size: 16px; }
            .info-box { background-color: #f0fdf4; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .warning { color: #b91c1c; font-size: 14px; margin-top: 20px; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}

            <div class="content">
              <h2>Hello ${firstName} ${lastName},</h2>

              <p>You have been invited to join <strong>${clinicName}</strong> as a <strong>${roleLabels[role] || role}</strong>.</p>

              <div class="info-box">
                <h3 style="margin: 0 0 10px 0; color: #059669;">Your Account Information</h3>
                <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
                <p style="margin: 5px 0;"><strong>Role:</strong> ${roleLabels[role] || role}</p>
              </div>

              <p>To activate your account and set your password, click the button below:</p>

              <center>
                <a href="${invitationUrl}" class="button">Activate My Account</a>
              </center>

              <p style="color: #666; font-size: 14px; text-align: center;">
                You can also copy this link into your browser:<br>
                <code style="word-break: break-all; font-size: 12px;">${invitationUrl}</code>
              </p>

              <p class="warning">
                ⚠️ <strong>Important:</strong> This invitation link expires on ${expiresDate}.
                Please activate your account before this date.
              </p>

              <h4>What happens next?</h4>
              <ol style="color: #666;">
                <li>Click the activation link</li>
                <li>Set your secure password</li>
                <li>Log in with your credentials</li>
                <li>Start using the platform</li>
              </ol>
            </div>

            <div class="footer">
              <p>© 2025 ${clinicName} - Powered by MedicalPro</p>
              <p>This email was sent to ${email}</p>
              <p style="color: #999; font-size: 11px;">
                If you did not request this invitation, please ignore this email.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Invitation email template - SPANISH
   */
  getInvitationEmailTemplateES({ email, firstName, lastName, clinicName, role, invitationUrl, expiresAt, logoUrl }) {
    const expiresDate = new Date(expiresAt).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const roleLabels = {
      physician: 'Médico',
      practitioner: 'Profesional de salud',
      secretary: 'Secretario/a',
      admin: 'Administrador',
      readonly: 'Usuario de solo lectura'
    };

    const header = this.getEmailHeader({
      title: '¡Bienvenido al Equipo!',
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#10b981, #059669'
    });

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background-color: #10b981; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; font-size: 16px; }
            .info-box { background-color: #f0fdf4; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .warning { color: #b91c1c; font-size: 14px; margin-top: 20px; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}

            <div class="content">
              <h2>Hola ${firstName} ${lastName},</h2>

              <p>Ha sido invitado/a a unirse a <strong>${clinicName}</strong> como <strong>${roleLabels[role] || role}</strong>.</p>

              <div class="info-box">
                <h3 style="margin: 0 0 10px 0; color: #059669;">Información de su cuenta</h3>
                <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
                <p style="margin: 5px 0;"><strong>Rol:</strong> ${roleLabels[role] || role}</p>
              </div>

              <p>Para activar su cuenta y establecer su contraseña, haga clic en el botón de abajo:</p>

              <center>
                <a href="${invitationUrl}" class="button">Activar Mi Cuenta</a>
              </center>

              <p style="color: #666; font-size: 14px; text-align: center;">
                También puede copiar este enlace en su navegador:<br>
                <code style="word-break: break-all; font-size: 12px;">${invitationUrl}</code>
              </p>

              <p class="warning">
                ⚠️ <strong>Importante:</strong> Este enlace de invitación expira el ${expiresDate}.
                Por favor active su cuenta antes de esta fecha.
              </p>

              <h4>¿Qué pasa después?</h4>
              <ol style="color: #666;">
                <li>Haga clic en el enlace de activación</li>
                <li>Establezca su contraseña segura</li>
                <li>Inicie sesión con sus credenciales</li>
                <li>Comience a usar la plataforma</li>
              </ol>
            </div>

            <div class="footer">
              <p>© 2025 ${clinicName} - Impulsado por MedicalPro</p>
              <p>Este correo fue enviado a ${email}</p>
              <p style="color: #999; font-size: 11px;">
                Si no solicitó esta invitación, por favor ignore este correo.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // Shared layout helpers (used by migrated messaging templates)
  // ══════════════════════════════════════════════════════════════════

  /**
   * Fetch clinic info (name, logo, phone, address) from medical_facilities
   * @param {Object} clinicDb - Sequelize clinic database connection
   * @returns {Object} { clinicName, logoUrl, phone, address }
   */
  async getClinicInfo(clinicDb) {
    const info = { clinicName: 'Clinique', logoUrl: null, phone: null, address: null };
    try {
      const [rows] = await clinicDb.query(
        'SELECT name, logo_url, phone, street, city, postal_code, country FROM medical_facilities LIMIT 1'
      );
      if (rows[0]) {
        const f = rows[0];
        info.clinicName = f.name || info.clinicName;
        if (f.logo_url) {
          const baseUrl = process.env.BACKEND_URL || process.env.APP_URL || 'http://localhost:3001';
          info.logoUrl = `${baseUrl}${f.logo_url}`;
        }
        info.phone = f.phone || null;
        const addressParts = [];
        if (f.street) addressParts.push(f.street);
        if (f.postal_code && f.city) addressParts.push(`${f.postal_code} ${f.city}`);
        else if (f.city) addressParts.push(f.city);
        if (f.country) addressParts.push(f.country);
        info.address = addressParts.length > 0 ? addressParts.join(', ') : null;
      }
    } catch (e) {
      // Silently ignore - facility info is optional
    }
    return info;
  }

  /**
   * Build a full email footer
   * @param {string} clinicName
   * @param {string} email - Recipient email shown in footer
   */
  getEmailFooter(clinicName, email) {
    return `
      <div class="footer" style="color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
        <p>&copy; ${new Date().getFullYear()} ${clinicName} - Powered by MedicalPro</p>
        ${email ? `<p>This email was sent to ${email}</p>` : ''}
      </div>`;
  }

  /**
   * Wrap content in the full email layout (DOCTYPE, head, styles, container)
   * @param {Object} opts
   * @param {string} opts.header - HTML from getEmailHeader()
   * @param {string} opts.content - Inner HTML body
   * @param {string} opts.footer - HTML from getEmailFooter()
   * @param {string} [opts.accentColor='#667eea'] - Button/accent color
   */
  getEmailLayout({ header, content, footer, accentColor = '#667eea' }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background-color: ${accentColor}; color: white !important; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; font-size: 16px; }
            .info-box { border-radius: 8px; padding: 20px; margin: 20px 0; }
            .footer { color: #999; font-size: 12px; text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
          </style>
        </head>
        <body>
          <div class="container">
            ${header}
            <div class="content">
              ${content}
            </div>
            ${footer}
          </div>
        </body>
      </html>`;
  }

  // ══════════════════════════════════════════════════════════════════
  // Appointment Confirmation Email
  // ══════════════════════════════════════════════════════════════════

  /**
   * Send appointment confirmation email
   */
  async sendAppointmentConfirmation({ email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, confirmationUrl, language = 'fr', logoUrl = null }) {
    try {
      const recipientEmail = this.getRecipientEmail(email);

      let htmlContent = this._getAppointmentConfirmationHtml(language, { email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, confirmationUrl, logoUrl });

      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const subjects = {
        fr: `Confirmez votre rendez-vous - ${clinicName}`,
        en: `Confirm your appointment - ${clinicName}`,
        es: `Confirme su cita - ${clinicName}`
      };

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(subjects[language] || subjects.fr, 'CONFIRMATION'),
        html: htmlContent
      };

      const result = await this.transporter.sendMail(mailOptions);

      logger.info(`Appointment confirmation email sent to ${email}`, {
        provider: this.provider,
        testMode: this.testModeEnabled
      });

      return {
        success: true,
        channel: 'email',
        provider: this.provider,
        messageId: result.messageId,
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      };
    } catch (error) {
      logger.error(`Failed to send appointment confirmation email to ${email}:`, error);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  _getAppointmentConfirmationHtml(language, params) {
    const { email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, confirmationUrl, logoUrl } = params;
    const header = this.getEmailHeader({
      title: { fr: 'Confirmez votre rendez-vous', en: 'Confirm Your Appointment', es: 'Confirme su Cita' }[language] || 'Confirmez votre rendez-vous',
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#667eea, #764ba2'
    });
    const footer = this.getEmailFooter(clinicName, email);

    const texts = {
      fr: {
        greeting: `Bonjour ${patientName},`,
        intro: `Vous avez un rendez-vous prévu chez <strong>${clinicName}</strong>.`,
        date: 'Date',
        time: 'Heure',
        treatment: 'Traitement',
        confirm: 'Merci de confirmer votre présence en cliquant sur le bouton ci-dessous :',
        button: 'Confirmer ma présence',
        note: 'Si vous ne pouvez pas venir, merci de nous contacter pour reporter votre rendez-vous.'
      },
      en: {
        greeting: `Hello ${patientName},`,
        intro: `You have an appointment scheduled at <strong>${clinicName}</strong>.`,
        date: 'Date',
        time: 'Time',
        treatment: 'Treatment',
        confirm: 'Please confirm your attendance by clicking the button below:',
        button: 'Confirm My Attendance',
        note: 'If you cannot attend, please contact us to reschedule your appointment.'
      },
      es: {
        greeting: `Hola ${patientName},`,
        intro: `Tiene una cita programada en <strong>${clinicName}</strong>.`,
        date: 'Fecha',
        time: 'Hora',
        treatment: 'Tratamiento',
        confirm: 'Por favor confirme su asistencia haciendo clic en el botón de abajo:',
        button: 'Confirmar Mi Asistencia',
        note: 'Si no puede asistir, contáctenos para reprogramar su cita.'
      }
    };
    const t = texts[language] || texts.fr;

    const content = `
      <h2>${t.greeting}</h2>
      <p>${t.intro}</p>
      <div class="info-box" style="background-color: #f0f4ff; border: 1px solid #667eea;">
        <p style="margin: 5px 0;"><strong>${t.date} :</strong> ${appointmentDate}</p>
        <p style="margin: 5px 0;"><strong>${t.time} :</strong> ${appointmentTime}</p>
        ${serviceName ? `<p style="margin: 5px 0;"><strong>${t.treatment} :</strong> ${serviceName}</p>` : ''}
      </div>
      <p>${t.confirm}</p>
      <center>
        <a href="${confirmationUrl}" class="button">${t.button}</a>
      </center>
      <p style="color: #666; font-size: 14px;">${t.note}</p>`;

    return this.getEmailLayout({ header, content, footer, accentColor: '#667eea' });
  }

  // ══════════════════════════════════════════════════════════════════
  // Appointment Reminder Email
  // ══════════════════════════════════════════════════════════════════

  /**
   * Send appointment reminder email
   */
  async sendAppointmentReminder({ email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, address, language = 'fr', logoUrl = null }) {
    try {
      const recipientEmail = this.getRecipientEmail(email);

      let htmlContent = this._getAppointmentReminderHtml(language, { email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, address, logoUrl });

      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const subjects = {
        fr: `Rappel: Rendez-vous demain - ${clinicName}`,
        en: `Reminder: Appointment tomorrow - ${clinicName}`,
        es: `Recordatorio: Cita mañana - ${clinicName}`
      };

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(subjects[language] || subjects.fr, 'REMINDER'),
        html: htmlContent
      };

      const result = await this.transporter.sendMail(mailOptions);

      logger.info(`Appointment reminder email sent to ${email}`, {
        provider: this.provider,
        testMode: this.testModeEnabled
      });

      return {
        success: true,
        channel: 'email',
        provider: this.provider,
        messageId: result.messageId,
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      };
    } catch (error) {
      logger.error(`Failed to send appointment reminder email to ${email}:`, error);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  _getAppointmentReminderHtml(language, params) {
    const { email, patientName, clinicName, appointmentDate, appointmentTime, serviceName, address, logoUrl } = params;
    const header = this.getEmailHeader({
      title: { fr: 'Rappel de rendez-vous', en: 'Appointment Reminder', es: 'Recordatorio de Cita' }[language] || 'Rappel de rendez-vous',
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#f59e0b, #d97706'
    });
    const footer = this.getEmailFooter(clinicName, email);

    const texts = {
      fr: {
        greeting: `Bonjour ${patientName},`,
        intro: `Nous vous rappelons votre rendez-vous <strong>demain</strong> chez ${clinicName}.`,
        date: 'Date',
        time: 'Heure',
        treatment: 'Traitement',
        address: 'Adresse',
        docs: "N'oubliez pas d'apporter vos documents d'identité et votre carte de santé.",
        note: 'En cas d\'empêchement, merci de nous prévenir au plus vite.'
      },
      en: {
        greeting: `Hello ${patientName},`,
        intro: `This is a reminder of your appointment <strong>tomorrow</strong> at ${clinicName}.`,
        date: 'Date',
        time: 'Time',
        treatment: 'Treatment',
        address: 'Address',
        docs: "Don't forget to bring your ID and health card.",
        note: 'If you cannot make it, please let us know as soon as possible.'
      },
      es: {
        greeting: `Hola ${patientName},`,
        intro: `Le recordamos su cita <strong>mañana</strong> en ${clinicName}.`,
        date: 'Fecha',
        time: 'Hora',
        treatment: 'Tratamiento',
        address: 'Dirección',
        docs: 'No olvide traer su documento de identidad y tarjeta sanitaria.',
        note: 'Si no puede asistir, avísenos lo antes posible.'
      }
    };
    const t = texts[language] || texts.fr;

    const content = `
      <h2>${t.greeting}</h2>
      <p>${t.intro}</p>
      <div class="info-box" style="background-color: #fffbeb; border: 1px solid #f59e0b;">
        <p style="margin: 5px 0;"><strong>${t.date} :</strong> ${appointmentDate}</p>
        <p style="margin: 5px 0;"><strong>${t.time} :</strong> ${appointmentTime}</p>
        ${serviceName ? `<p style="margin: 5px 0;"><strong>${t.treatment} :</strong> ${serviceName}</p>` : ''}
        ${address ? `<p style="margin: 5px 0;"><strong>${t.address} :</strong> ${address}</p>` : ''}
      </div>
      <p>${t.docs}</p>
      <p style="color: #666; font-size: 14px;">${t.note}</p>`;

    return this.getEmailLayout({ header, content, footer, accentColor: '#f59e0b' });
  }

  // ══════════════════════════════════════════════════════════════════
  // Quote Sent Email
  // ══════════════════════════════════════════════════════════════════

  /**
   * Send quote notification email
   */
  async sendQuoteSent({ email, patientName, clinicName, quoteNumber, totalAmount, viewUrl, language = 'fr', logoUrl = null }) {
    try {
      const recipientEmail = this.getRecipientEmail(email);

      let htmlContent = this._getQuoteSentHtml(language, { email, patientName, clinicName, quoteNumber, totalAmount, viewUrl, logoUrl });

      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const subjects = {
        fr: `Votre devis - ${clinicName}`,
        en: `Your quote - ${clinicName}`,
        es: `Su presupuesto - ${clinicName}`
      };

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(subjects[language] || subjects.fr, 'QUOTE'),
        html: htmlContent
      };

      const result = await this.transporter.sendMail(mailOptions);

      logger.info(`Quote email sent to ${email}`, {
        provider: this.provider,
        testMode: this.testModeEnabled
      });

      return {
        success: true,
        channel: 'email',
        provider: this.provider,
        messageId: result.messageId,
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      };
    } catch (error) {
      logger.error(`Failed to send quote email to ${email}:`, error);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  _getQuoteSentHtml(language, params) {
    const { email, patientName, clinicName, quoteNumber, totalAmount, viewUrl, logoUrl } = params;
    const header = this.getEmailHeader({
      title: { fr: 'Votre devis', en: 'Your Quote', es: 'Su Presupuesto' }[language] || 'Votre devis',
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#10b981, #059669'
    });
    const footer = this.getEmailFooter(clinicName, email);

    const texts = {
      fr: {
        greeting: `Bonjour ${patientName},`,
        intro: 'Veuillez trouver ci-joint votre devis pour les soins prévus.',
        number: 'Numéro',
        amount: 'Montant total',
        currency: '€',
        button: 'Voir le devis',
        note: "Ce devis est valable 30 jours. Pour toute question, n'hésitez pas à nous contacter."
      },
      en: {
        greeting: `Hello ${patientName},`,
        intro: 'Please find enclosed your quote for the planned treatments.',
        number: 'Number',
        amount: 'Total Amount',
        currency: '€',
        button: 'View Quote',
        note: 'This quote is valid for 30 days. For any questions, please contact us.'
      },
      es: {
        greeting: `Hola ${patientName},`,
        intro: 'Por favor encuentre adjunto su presupuesto para los tratamientos previstos.',
        number: 'Número',
        amount: 'Importe Total',
        currency: '€',
        button: 'Ver Presupuesto',
        note: 'Este presupuesto es válido por 30 días. Para cualquier pregunta, contáctenos.'
      }
    };
    const t = texts[language] || texts.fr;

    const content = `
      <h2>${t.greeting}</h2>
      <p>${t.intro}</p>
      <div class="info-box" style="background-color: #f0fdf4; border: 1px solid #10b981;">
        <p style="margin: 5px 0;"><strong>${t.number} :</strong> ${quoteNumber}</p>
        <p style="margin: 5px 0;"><strong>${t.amount} :</strong> ${totalAmount} ${t.currency}</p>
      </div>
      ${viewUrl ? `
      <center>
        <a href="${viewUrl}" class="button">${t.button}</a>
      </center>` : ''}
      <p style="color: #666; font-size: 14px;">${t.note}</p>`;

    return this.getEmailLayout({ header, content, footer, accentColor: '#10b981' });
  }

  // ══════════════════════════════════════════════════════════════════
  // Invoice Ready Email
  // ══════════════════════════════════════════════════════════════════

  /**
   * Send invoice ready notification email
   */
  async sendInvoiceReady({ email, patientName, clinicName, invoiceNumber, totalAmount, viewUrl, language = 'fr', logoUrl = null }) {
    try {
      const recipientEmail = this.getRecipientEmail(email);

      let htmlContent = this._getInvoiceReadyHtml(language, { email, patientName, clinicName, invoiceNumber, totalAmount, viewUrl, logoUrl });

      if (this.testModeEnabled) {
        htmlContent = this.wrapEmailContentWithTestInfo(htmlContent, email);
      }

      const subjects = {
        fr: `Votre facture - ${clinicName}`,
        en: `Your invoice - ${clinicName}`,
        es: `Su factura - ${clinicName}`
      };

      const mailOptions = {
        from: process.env.FROM_EMAIL || 'noreply@medicalpro.com',
        to: recipientEmail,
        subject: this.getEmailSubject(subjects[language] || subjects.fr, 'INVOICE'),
        html: htmlContent
      };

      const result = await this.transporter.sendMail(mailOptions);

      logger.info(`Invoice email sent to ${email}`, {
        provider: this.provider,
        testMode: this.testModeEnabled
      });

      return {
        success: true,
        channel: 'email',
        provider: this.provider,
        messageId: result.messageId,
        testMode: this.testModeEnabled,
        actualRecipient: this.testModeEnabled ? recipientEmail : email
      };
    } catch (error) {
      logger.error(`Failed to send invoice email to ${email}:`, error);
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  _getInvoiceReadyHtml(language, params) {
    const { email, patientName, clinicName, invoiceNumber, totalAmount, viewUrl, logoUrl } = params;
    const header = this.getEmailHeader({
      title: { fr: 'Votre facture', en: 'Your Invoice', es: 'Su Factura' }[language] || 'Votre facture',
      subtitle: clinicName,
      logoUrl,
      gradientColors: '#3b82f6, #1d4ed8'
    });
    const footer = this.getEmailFooter(clinicName, email);

    const texts = {
      fr: {
        greeting: `Bonjour ${patientName},`,
        intro: 'Votre facture pour les soins reçus est disponible.',
        number: 'Numéro',
        amount: 'Montant',
        currency: '€',
        button: 'Voir la facture',
        note: "Pour toute question concernant cette facture, n'hésitez pas à nous contacter."
      },
      en: {
        greeting: `Hello ${patientName},`,
        intro: 'Your invoice for the services received is now available.',
        number: 'Number',
        amount: 'Amount',
        currency: '€',
        button: 'View Invoice',
        note: 'For any questions regarding this invoice, please contact us.'
      },
      es: {
        greeting: `Hola ${patientName},`,
        intro: 'Su factura por los servicios recibidos está disponible.',
        number: 'Número',
        amount: 'Importe',
        currency: '€',
        button: 'Ver Factura',
        note: 'Para cualquier pregunta sobre esta factura, contáctenos.'
      }
    };
    const t = texts[language] || texts.fr;

    const content = `
      <h2>${t.greeting}</h2>
      <p>${t.intro}</p>
      <div class="info-box" style="background-color: #f0f7ff; border: 1px solid #3b82f6;">
        <p style="margin: 5px 0;"><strong>${t.number} :</strong> ${invoiceNumber}</p>
        <p style="margin: 5px 0;"><strong>${t.amount} :</strong> ${totalAmount} ${t.currency}</p>
      </div>
      ${viewUrl ? `
      <center>
        <a href="${viewUrl}" class="button">${t.button}</a>
      </center>` : ''}
      <p style="color: #666; font-size: 14px;">${t.note}</p>`;

    return this.getEmailLayout({ header, content, footer, accentColor: '#3b82f6' });
  }
}

// Export singleton instance
module.exports = new EmailService();
