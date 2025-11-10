const { Sequelize } = require('sequelize');
const winston = require('winston');

// Configuration de la base de données (central database)
const sequelize = new Sequelize({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.CENTRAL_DB_NAME || 'medicalpro_central',
  username: process.env.DB_USER || 'medicalpro',
  password: process.env.DB_PASSWORD || 'medicalpro2024',
  dialect: process.env.DB_DIALECT || 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  define: {
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Test de connexion
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    winston.info('✅ Database connection established successfully');
    return true;
  } catch (error) {
    winston.error('❌ Unable to connect to database:', error.message);
    return false;
  }
};

// Synchronisation des modèles (development only)
const syncDatabase = async (force = false) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ force, alter: false });
      winston.info('✅ Database synchronized');
    }
  } catch (error) {
    // Log the error but don't fail the server startup
    // Tables should already exist in production
    winston.warn('⚠️ Database sync warning:', error.message);
    if (process.env.NODE_ENV === 'development') {
      winston.warn('Note: Make sure UUID-OSSP extension is installed: CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    }
  }
};

module.exports = {
  sequelize,
  testConnection,
  syncDatabase
};