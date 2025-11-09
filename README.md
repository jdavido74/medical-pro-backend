# 🚀 FacturePro Backend API

Backend API pour FacturePro - Solution SaaS de facturation électronique conforme EN 16931.

## 📋 Table des Matières

- [Fonctionnalités](#fonctionnalités)
- [Stack Technique](#stack-technique)
- [Installation](#installation)
- [Configuration](#configuration)
- [Utilisation](#utilisation)
- [API Documentation](#api-documentation)
- [Tests](#tests)
- [Déploiement](#déploiement)

## ✨ Fonctionnalités

### ✅ Implémentées

- **Authentification JWT** avec refresh tokens
- **Gestion multi-entreprises** (multi-tenant)
- **CRUD complet** : Entreprises, Utilisateurs, Clients, Factures, Devis
- **Validation métier** : SIRET France (INSEE API) + NIF Espagne
- **Base de données PostgreSQL** avec relations complètes
- **Rate limiting** et sécurité
- **Logging structuré** avec Winston
- **Docker** ready pour développement et production

### 🚧 En Cours (US016 & US017)

- **Migration données** localStorage → PostgreSQL
- **Intégration Frontend** avec les nouvelles APIs
- **Tests automatisés** complets

## 🛠️ Stack Technique

- **Runtime**: Node.js 18+ LTS
- **Framework**: Express.js 4.18+
- **Base de données**: PostgreSQL 15+
- **ORM**: Sequelize 6+
- **Authentication**: JWT + bcrypt
- **Validation**: Joi
- **Logging**: Winston
- **Containerization**: Docker + Docker Compose

## 🚀 Installation

### Prérequis

- Node.js 18+ ou Docker
- PostgreSQL 15+ (ou utiliser Docker Compose)
- Git

### 1. Cloner le Repository

```bash
git clone <repository-url>
cd facture-pro-backend
```

### 2. Installation avec Docker (Recommandé)

```bash
# Copier le fichier d'environnement
cp .env.example .env

# Démarrer tous les services
docker-compose up -d

# Voir les logs
docker-compose logs -f api
```

### 3. Installation Manuelle

```bash
# Installer les dépendances
npm install

# Copier le fichier d'environnement
cp .env.example .env

# Démarrer PostgreSQL (si local)
# Puis configurer la base dans .env

# Démarrer l'application
npm run dev
```

## ⚙️ Configuration

### Variables d'Environnement

Créer un fichier `.env` basé sur `.env.example` :

```env
# Server
NODE_ENV=development
PORT=3001

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=facturepro
DB_USER=facturepro
DB_PASSWORD=secure_password

# JWT
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# API Externa (optionnel)
INSEE_API_TOKEN=your-insee-token
```

### Base de Données

La base est automatiquement initialisée avec :
- **Schema complet** (tables, index, contraintes)
- **Données de démonstration**
- **Fonctions métier** PostgreSQL
- **Vues pour analytics**

**Compte de démonstration :**
- Email: `admin@facturepro.com`
- Password: `demo123`

## 🎯 Utilisation

### Démarrage Rapide

```bash
# Avec Docker
docker-compose up -d

# Ou en local
npm run dev
```

**L'API sera disponible sur :**
- **API**: http://localhost:3001
- **Health check**: http://localhost:3001/health
- **Adminer** (dev): http://localhost:8080

### Scripts NPM

```bash
npm start          # Production
npm run dev        # Développement avec hot reload
npm test           # Tests
npm run test:watch # Tests en mode watch
npm run migrate    # Migration base de données
npm run seed       # Données de test
```

### Docker Commands

```bash
# Développement avec hot reload
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Production
docker-compose up -d

# Logs
docker-compose logs -f api

# Reset complet
docker-compose down -v
docker-compose up -d
```

## 📖 API Documentation

### Authentication

```bash
# Inscription
POST /api/v1/auth/register
{
  "companyName": "Ma Société",
  "country": "FR",
  "email": "user@example.com",
  "password": "secure123",
  "acceptTerms": true
}

# Connexion
POST /api/v1/auth/login
{
  "email": "user@example.com",
  "password": "secure123"
}

# Refresh token
POST /api/v1/auth/refresh
{
  "refreshToken": "..."
}
```

### Clients

```bash
# Liste des clients
GET /api/v1/clients?page=1&limit=20&search=martin

# Créer un client
POST /api/v1/clients
{
  "type": "company",
  "name": "Entreprise Martin",
  "email": "contact@martin.fr",
  "businessNumber": "12345678901234"
}

# Modifier un client
PUT /api/v1/clients/:id

# Supprimer un client
DELETE /api/v1/clients/:id
```

### Factures

```bash
# Liste des factures
GET /api/v1/invoices?status=draft&clientId=...

# Créer une facture
POST /api/v1/invoices
{
  "clientId": "uuid",
  "issueDate": "2024-09-23",
  "subtotal": 1000.00,
  "taxAmount": 200.00,
  "total": 1200.00,
  "items": [
    {
      "description": "Service consulting",
      "quantity": 1,
      "unitPrice": 1000.00
    }
  ]
}
```

### Devis

```bash
# Convertir devis en facture
POST /api/v1/quotes/:id/convert
```

### Validation Métier

```bash
# Valider SIRET français
POST /api/v1/validation/siret
{
  "siret": "12345678901234"
}

# Valider NIF espagnol
POST /api/v1/validation/nif
{
  "nif": "B12345674"
}
```

### Headers Requis

```bash
# Toutes les routes protégées
Authorization: Bearer <access_token>
Content-Type: application/json
```

## 🧪 Tests

```bash
# Lancer tous les tests
npm test

# Tests avec couverture
npm run test:coverage

# Tests en mode watch
npm run test:watch

# Tests d'intégration seulement
npm run test:integration
```

### Structure des Tests

```
tests/
├── unit/          # Tests unitaires
│   ├── models/
│   ├── services/
│   └── utils/
└── integration/   # Tests d'intégration
    ├── auth.test.js
    ├── clients.test.js
    └── invoices.test.js
```

## 🐳 Déploiement

### Production avec Docker

```bash
# Build image production
docker build -t facturepro-api .

# Ou avec docker-compose
docker-compose -f docker-compose.yml up -d
```

### Variables d'Environnement Production

```env
NODE_ENV=production
JWT_SECRET=secure-production-secret
DB_PASSWORD=secure-db-password
INSEE_API_TOKEN=real-insee-token
```

### Health Checks

L'API expose plusieurs endpoints de monitoring :

```bash
# Santé générale
GET /health

# Informations système
GET /api/v1/auth/me  # Avec auth
```

## 🔧 Troubleshooting

### Problèmes Courants

**1. Database Connection Error**
```bash
# Vérifier PostgreSQL
docker-compose logs database

# Reset complet
docker-compose down -v
docker-compose up -d
```

**2. JWT Token Issues**
```bash
# Vérifier les secrets dans .env
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
```

**3. Port Already in Use**
```bash
# Changer le port dans .env
PORT=3002

# Ou tuer le processus
sudo lsof -i :3001
kill -9 <PID>
```

**4. Migration Errors**
```bash
# Reset base de données
docker-compose down -v
docker-compose up -d database
# La migration se lance automatiquement
```

### Logs

```bash
# Logs API
docker-compose logs -f api

# Logs Database
docker-compose logs -f database

# Logs dans le container
docker exec -it facturepro-api tail -f logs/app.log
```

## 📊 Performance

### Benchmarks

- **Authentification**: ~50ms
- **CRUD Operations**: ~20-100ms
- **Validation SIRET**: ~1-2s (INSEE API)
- **Validation NIF**: ~1ms (local)

### Optimisations

- **Connection pooling** PostgreSQL
- **Rate limiting** configuré
- **Indexes** optimisés
- **GZIP compression**

## 🔐 Sécurité

- **JWT** avec expiration courte + refresh
- **bcrypt** pour hasher les mots de passe
- **Helmet** pour headers sécurisés
- **Rate limiting** anti-bruteforce
- **Validation** stricte des inputs
- **CORS** configuré

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature
3. Commit les changements
4. Push vers la branche
5. Créer une Pull Request

## 📄 License

MIT License

---

## 🆘 Support

Pour toute question ou problème :

1. Vérifier la [documentation API](#api-documentation)
2. Consulter les [logs](#logs)
3. Créer une issue GitHub

**Happy coding! 🚀**