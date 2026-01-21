const { User, Company } = require('./src/models');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function createAdmin() {
  try {
    // Vérifier si admin existe déjà
    const existingAdmin = await User.findOne({
      where: { email: 'superadmin@medicalpro.local' }
    });

    if (existingAdmin) {
      console.log('⚠️  Super Admin existe déjà');
      process.exit(0);
    }

    // Trouver ou créer une company
    let adminCompany = await Company.findOne({ 
      where: { email: 'admin@medicalpro.local' }
    });

    if (!adminCompany) {
      adminCompany = await Company.create({
        id: uuidv4(),
        name: 'Super Admin Company',
        email: 'admin@medicalpro-' + Date.now() + '.local',
        country: 'FR',
        is_active: true
      });
      console.log('✅ Company créée');
    } else {
      console.log('✅ Company existante utilisée');
    }

    // Créer l'utilisateur super_admin
    const hashedPassword = await bcrypt.hash('Admin@123456', 12);
    
    await User.create({
      id: uuidv4(),
      company_id: adminCompany.id,
      email: 'superadmin@medicalpro.local',
      password_hash: hashedPassword,
      first_name: 'Super',
      last_name: 'Admin',
      role: 'super_admin',
      email_verified: true,
      is_active: true
    });

    console.log('✅ Super Admin créé');
    console.log('');
    console.log('🔑 Identifiants de connexion:');
    console.log('  Email:       superadmin@medicalpro.local');
    console.log('  Mot de passe: Admin@123456');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

createAdmin();
