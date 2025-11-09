# FacturePro Backend Dockerfile
FROM node:18-alpine

# Installer les dépendances système nécessaires
RUN apk add --no-cache \
    postgresql-client \
    curl \
    && rm -rf /var/cache/apk/*

# Créer un utilisateur non-root pour la sécurité
RUN addgroup -g 1001 -S nodejs && \
    adduser -S facturepro -u 1001

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm ci --only=production && \
    npm cache clean --force

# Copier le code source
COPY --chown=facturepro:nodejs . .

# Créer les répertoires nécessaires
RUN mkdir -p logs && \
    chown -R facturepro:nodejs logs

# Changer vers l'utilisateur non-root
USER facturepro

# Exposer le port
EXPOSE 3001

# Définir les variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3001

# Commande de démarrage
CMD ["npm", "start"]

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1