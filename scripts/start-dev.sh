#!/bin/bash

# FacturePro Backend Development Startup Script

set -e

echo "🚀 Starting FacturePro Backend Development Environment"
echo "=================================================="

# Check if Docker is available
if command -v docker &> /dev/null; then
    echo "✅ Docker is available"

    # Check if Docker Compose is available
    if command -v docker-compose &> /dev/null; then
        echo "✅ Docker Compose is available"
        echo ""
        echo "🐳 Starting with Docker Compose..."
        echo ""

        # Start services with development override
        docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

        echo ""
        echo "⏳ Waiting for services to be ready..."
        sleep 10

        # Show service status
        echo ""
        echo "📊 Service Status:"
        docker-compose ps

        echo ""
        echo "🔗 Services Available:"
        echo "   • API: http://localhost:3001"
        echo "   • Health: http://localhost:3001/health"
        echo "   • Adminer: http://localhost:8080"
        echo ""
        echo "📋 Demo Login:"
        echo "   • Email: admin@facturepro.com"
        echo "   • Password: demo123"
        echo ""
        echo "📝 Useful Commands:"
        echo "   • Logs: docker-compose logs -f api"
        echo "   • Stop: docker-compose down"
        echo "   • Reset: docker-compose down -v && docker-compose up -d"
        echo ""

    else
        echo "❌ Docker Compose not found. Please install Docker Compose."
        exit 1
    fi
else
    echo "❌ Docker not found. Starting with Node.js..."
    echo ""

    # Check if Node.js is available
    if command -v node &> /dev/null; then
        echo "✅ Node.js is available: $(node --version)"

        # Check if npm dependencies are installed
        if [ ! -d "node_modules" ]; then
            echo "📦 Installing dependencies..."
            npm install
        fi

        # Check if .env exists
        if [ ! -f ".env" ]; then
            echo "⚙️  Creating .env file..."
            cp .env.example .env
            echo "⚠️  Please configure your .env file, especially database settings!"
        fi

        echo ""
        echo "🚀 Starting development server..."
        npm run dev

    else
        echo "❌ Node.js not found. Please install Node.js 18+ or use Docker."
        exit 1
    fi
fi