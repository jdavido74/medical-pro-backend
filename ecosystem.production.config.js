/**
 * PM2 Ecosystem Configuration for Production
 *
 * MedicalPro SaaS - Production Server
 *
 * Usage:
 *   pm2 start ecosystem.production.config.js
 *   pm2 restart ecosystem.production.config.js
 *   pm2 reload ecosystem.production.config.js --update-env
 *
 * Important: Run `pm2 save` after starting to persist across reboots
 *            Run `pm2 startup` to enable auto-start on boot
 */

module.exports = {
  apps: [
    // ==========================================================================
    // Backend API Server
    // ==========================================================================
    {
      name: 'medical-pro-backend',
      script: 'server.js',
      cwd: '/var/www/medical-pro-backend',

      // Cluster mode for load balancing
      instances: 2,
      exec_mode: 'cluster',

      // Environment
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },

      // Memory management
      max_memory_restart: '500M',

      // Restart policy
      autorestart: true,
      restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '10s',

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/pm2/medical-pro-backend-error.log',
      out_file: '/var/log/pm2/medical-pro-backend-out.log',
      merge_logs: true,

      // Monitoring
      exp_backoff_restart_delay: 100,

      // Source maps for error traces
      source_map_support: true
    },

    // ==========================================================================
    // Frontend Static Server
    // ==========================================================================
    {
      name: 'medical-pro-frontend',
      script: 'npx',
      args: 'serve -s build -l 3000',
      cwd: '/var/www/medical-pro',

      // Single instance for static serving
      instances: 1,
      exec_mode: 'fork',

      // Environment
      env: {
        NODE_ENV: 'production'
      },

      // Memory management
      max_memory_restart: '300M',

      // Restart policy
      autorestart: true,
      restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '10s',

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/pm2/medical-pro-frontend-error.log',
      out_file: '/var/log/pm2/medical-pro-frontend-out.log',
      merge_logs: true
    }
  ],

  // ==========================================================================
  // Deployment Configuration (for pm2 deploy)
  // ==========================================================================
  deploy: {
    production: {
      // SSH connection
      user: 'deploy',
      host: 'YOUR_SERVER_IP',
      ssh_options: 'StrictHostKeyChecking=no',

      // Repository
      ref: 'origin/master',
      repo: 'git@github.com:jdavido74/medical-pro-backend.git',
      path: '/var/www/medical-pro-backend',

      // Commands to run after deployment
      'pre-deploy-local': '',
      'post-deploy': 'npm ci --production && pm2 reload ecosystem.production.config.js --env production',
      'pre-setup': ''
    }
  }
};
