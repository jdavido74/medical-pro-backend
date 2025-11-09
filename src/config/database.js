const { Sequelize } = require('sequelize');
const winston = require('winston');

// Configuration de la base de données
const sequelize = new Sequelize({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'facturepro',
  username: process.env.DB_USER || 'facturepro',
  password: process.env.DB_PASSWORD || 'secure_password',
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
      await sequelize.sync({ force });
      winston.info('✅ Database synchronized');
    }
  } catch (error) {
    winston.error('❌ Database sync failed:', error.message);
    throw error;
  }
};

module.exports = {
  sequelize,
  testConnection,
  syncDatabase
};