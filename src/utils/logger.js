const winston = require('winston');
const path = require('path');

// Configuration des niveaux de log
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Couleurs pour la console
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

winston.addColors(logColors);

// Format pour la console
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Format pour les fichiers
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Transports
const transports = [
  // Console output
  new winston.transports.Console({
    format: consoleFormat,
    level: process.env.LOG_LEVEL || 'info'
  })
];

// Ajouter transport fichier en production
if (process.env.NODE_ENV === 'production') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: fileFormat
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: fileFormat
    })
  );
}

// Configuration du logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels: logLevels,
  format: fileFormat,
  transports,
  exceptionHandlers: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  rejectionHandlers: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ]
});

// Middleware pour Express (Morgan)
const httpLoggerStream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

module.exports = {
  logger,
  httpLoggerStream
};