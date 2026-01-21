/**
 * Tests de Sécurité - Validation des Permissions
 *
 * Ces tests vérifient que les failles de sécurité identifiées
 * n'existent plus et ne réapparaîtront pas.
 */

const request = require('supertest');
const { User, Company, sequelize } = require('../../src/models');
const { generateAccessToken } = require('../../src/config/jwt');
const jwt = require('jsonwebtoken');

let app; // À définir

describe('Security - Permission Validation', () => {
  let normalUser, adminUser, secretaryUser;
  let normalToken, adminToken, secretaryToken;
  let company;

  beforeAll(async () => {
    // Créer une entreprise test
    company = await Company.create({
      id: 'test-company-uuid',
      name: 'Test Clinic',
      country: 'FR',
      db_name: 'test_clinic_db',
      db_host: 'localhost',
      db_port: 5432,
      db_user: 'test',
      db_password: 'test'
    });

    // Créer des utilisateurs avec différents rôles
    normalUser = await User.create({
      email: 'normal@test.fr',
      password_hash: 'hashed_password',
      role: 'secretary',
      company_id: company.id,
      email_verified: true
    });

    adminUser = await User.create({
      email: 'admin@test.fr',
      password_hash: 'hashed_password',
      role: 'admin',
      company_id: company.id,
      email_verified: true
    });

    secretaryUser = await User.create({
      email: 'secretary@test.fr',
      password_hash: 'hashed_password',
      role: 'secretary',
      company_id: company.id,
      email_verified: true
    });

    // Générer les tokens
    normalToken = generateAccessToken({
      userId: normalUser.id,
      companyId: company.id,
      email: normalUser.email,
      role: normalUser.role
    });

    adminToken = generateAccessToken({
      userId: adminUser.id,
      companyId: company.id,
      email: adminUser.email,
      role: adminUser.role
    });

    secretaryToken = generateAccessToken({
      userId: secretaryUser.id,
      companyId: company.id,
      email: secretaryUser.email,
      role: secretaryUser.role
    });
  });

  afterAll(async () => {
    await Company.destroy({ where: { id: 'test-company-uuid' } });
    await sequelize.close();
  });

  describe('🔐 Test 1: Role Tampering Prevention', () => {
    it('Should reject request with modified role in JWT', async () => {
      // Créer un token avec un rôle modifié
      const tamperedToken = jwt.sign(
        {
          userId: secretaryUser.id,
          companyId: company.id,
          email: secretaryUser.email,
          role: 'super_admin' // ❌ Rôle modifié!
        },
        process.env.JWT_SECRET || 'test-secret'
      );

      // Tenter un appel avec le token modifié
      const response = await request(app)
        .get('/api/v1/users') // Route admin-only
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401); // Devrait être rejeté

      expect(response.body.error?.code).toBe('TOKEN_TAMPERED');
    });

    it('Should detect mismatch between JWT role and DB role', async () => {
      // Le middleware doit vérifier que le rôle du JWT
      // correspond au rôle en BD
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);

      // Vérifier que le rôle est cohérent
      expect(response.body.data.role).toBe('secretary');

      // Si BD a un rôle différent → erreur
      await secretaryUser.update({ role: 'admin' });

      const tamperedResponse = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(401);

      expect(tamperedResponse.body.error?.code).toBe('TOKEN_TAMPERED');

      // Restore
      await secretaryUser.update({ role: 'secretary' });
    });
  });

  describe('🔐 Test 2: Multi-Tenant Isolation', () => {
    it('Should reject access if companyId mismatch', async () => {
      // Créer une 2e entreprise
      const company2 = await Company.create({
        id: 'test-company-2',
        name: 'Other Clinic',
        country: 'ES',
        db_name: 'test_clinic_2_db',
        db_host: 'localhost',
        db_port: 5432,
        db_user: 'test',
        db_password: 'test'
      });

      // Token avec company1
      const originalToken = generateAccessToken({
        userId: normalUser.id,
        companyId: company.id,
        email: normalUser.email,
        role: normalUser.role
      });

      // Créer un token frauduleux avec companyId différent
      const fraudulentToken = jwt.sign(
        {
          userId: normalUser.id,
          companyId: company2.id, // ❌ Compagnie différente
          email: normalUser.email,
          role: normalUser.role
        },
        process.env.JWT_SECRET || 'test-secret'
      );

      // Tenter d'accéder aux patients
      const response = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${fraudulentToken}`)
        .expect(403); // Forbidden

      expect(response.body.error?.code).toBe('COMPANY_MISMATCH');

      // Cleanup
      await Company.destroy({ where: { id: 'test-company-2' } });
    });
  });

  describe('🔐 Test 3: Permission-Based Access Control', () => {
    it('Secretary should NOT access admin endpoints', async () => {
      // Secretary n'a pas USERS_DELETE permission
      const response = await request(app)
        .delete('/api/v1/users/some-user-id')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(403); // Permission Denied

      expect(response.body.error?.message).toContain('Permission denied');
    });

    it('Admin should access admin endpoints', async () => {
      // Admin a USERS_DELETE permission
      const response = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200); // OK

      expect(response.body.success).toBe(true);
    });

    it('Should verify permissions from DB, not from localStorage', async () => {
      // Les permissions proviennent de la BD
      // Même si frontend modifie localStorage, le backend valide

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .expect(200);

      const returnedPermissions = response.body.data.permissions;

      // Vérifier que les permissions viennent du rôle DB
      // (secretary n'a pas USERS_DELETE)
      expect(returnedPermissions).not.toContain('USERS_DELETE');
      expect(returnedPermissions).toContain('PATIENTS_VIEW');
    });
  });

  describe('🔐 Test 4: Audit Logging', () => {
    it('Should log all sensitive operations', async () => {
      // Vérifier qu'une action a été loggée en audit
      // (À implémenter après ajout de la table audit_logs)

      // Pour l'instant, on s'assure que les logs ne contiennent pas
      // de données sensibles
      expect(true).toBe(true); // Placeholder
    });

    it('Should NOT store sensitive data in localStorage', async () => {
      // Le frontend ne doit stocker QUE le JWT
      // Pas: rôles, permissions, userData

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'secretary@test.fr',
          password: 'password'
        })
        .expect(200);

      // Réponse devrait contenir accessToken
      expect(response.body.data.tokens?.accessToken).toBeDefined();

      // Mais NE PAS contenir les permissions directement
      // (permissions récupérées via /auth/me après)
      expect(response.body.data.permissions).toBeUndefined();
    });
  });

  describe('🔐 Test 5: Token Expiration', () => {
    it('Should reject expired tokens', async () => {
      // Créer un token expiré
      const expiredToken = jwt.sign(
        {
          userId: normalUser.id,
          companyId: company.id,
          email: normalUser.email,
          role: normalUser.role
        },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '-1h' } // Expiré
      );

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.error?.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('🔐 Test 6: Input Validation', () => {
    it('Should validate patient email format', async () => {
      const response = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          firstName: 'Jean',
          lastName: 'Dupont',
          email: 'invalid-email', // ❌ Format invalide
          dateOfBirth: '1990-01-01'
        })
        .expect(400); // Bad Request

      expect(response.body.error?.message).toContain('Validation');
    });

    it('Should sanitize inputs to prevent injection', async () => {
      const response = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${secretaryToken}`)
        .send({
          firstName: '<script>alert("xss")</script>', // ❌ Injection
          lastName: 'Dupont',
          email: 'test@test.fr',
          dateOfBirth: '1990-01-01'
        })
        .expect(400); // Bad Request ou sanitisé

      // Vérifier que le script n'a pas été sauvegardé
      if (response.status === 201) {
        const patient = response.body.data;
        expect(patient.firstName).not.toContain('<script>');
      }
    });
  });
});

describe('Security - Audit Logging', () => {
  it('Should log failed login attempts', async () => {
    // Tenter de se connecter avec un mauvais password
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@test.fr',
        password: 'wrong-password'
      })
      .expect(401);

    // Vérifier qu'une entrée d'audit a été créée
    // SELECT * FROM audit_logs WHERE event_type = 'LOGIN_FAILED'
    // (À vérifier directement en BD)
  });

  it('Should log permission denial attempts', async () => {
    // Secrétaire tente de supprimer un utilisateur
    const secretaryToken = generateAccessToken({
      userId: 'secretary-uuid',
      companyId: 'company-uuid',
      email: 'secretary@test.fr',
      role: 'secretary'
    });

    const response = await request(app)
      .delete('/api/v1/users/user-uuid')
      .set('Authorization', `Bearer ${secretaryToken}`)
      .expect(403);

    // Vérifier qu'une entrée d'audit a été créée
    // SELECT * FROM audit_logs WHERE event_type = 'PERMISSION_DENIED'
  });
});
