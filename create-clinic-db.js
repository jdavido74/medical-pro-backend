const { sequelize } = require('./src/config/database');
const { User, Company } = require('./src/models');

async function provisionClinicDatabase() {
  try {
    // Récupérer la company du super_admin
    const company = await Company.findOne({
      where: { name: 'Super Admin Company' }
    });

    if (!company) {
      console.log('❌ Company Super Admin Company not found');
      process.exit(1);
    }

    const companyId = company.id;
    const dbName = `medicalpro_clinic_${companyId}`;

    console.log(`📍 Provisioning clinic database for company: ${companyId}`);
    console.log(`📂 Database name: ${dbName}`);

    // Créer la base de données
    try {
      await sequelize.query(`CREATE DATABASE "${dbName}";`);
      console.log(`✅ Database created: ${dbName}`);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(`ℹ️  Database already exists: ${dbName}`);
      } else {
        throw err;
      }
    }

    // Créer une nouvelle connexion pour la clinic
    const { Sequelize } = require('sequelize');
    const clinicSequelize = new Sequelize(
      dbName,
      process.env.DB_USER || 'medicalpro',
      process.env.DB_PASSWORD || 'medicalpro2024',
      {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false,
        retry: {
          max: 3,
          timeout: 3000
        }
      }
    );

    // Synchroniser tous les modèles dans la clinic database
    console.log('🔄 Synchronizing models...');

    // Importer les modèles pour la clinic
    const Patient = require('./src/models/Patient');
    const Appointment = require('./src/models/Appointment');
    const Client = require('./src/models/Client');
    const Invoice = require('./src/models/Invoice');
    const Quote = require('./src/models/Quote');
    const Practitioner = require('./src/models/Practitioner');
    const MedicalRecord = require('./src/models/MedicalRecord');
    const Document = require('./src/models/Document');
    const Consent = require('./src/models/Consent');
    const ConsentTemplate = require('./src/models/ConsentTemplate');
    const AuditLog = require('./src/models/AuditLog');
    const Category = require('./src/models/Category');
    const ProductService = require('./src/models/ProductService');
    const AppointmentItem = require('./src/models/AppointmentItem');
    const DocumentItem = require('./src/models/DocumentItem');

    // Synchroniser la base de données
    await clinicSequelize.sync({ alter: false, force: false });
    console.log(`✅ All tables created/synchronized for clinic`);

    console.log('');
    console.log('✨ Clinic database provisioned successfully!');
    console.log(`Database: ${dbName}`);
    console.log(`Company ID: ${companyId}`);
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error provisioning clinic database:', error.message);
    process.exit(1);
  }
}

provisionClinicDatabase();
