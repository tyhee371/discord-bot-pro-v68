# Discord Bot Deployment Guide
# Phase 5: Production Deployment and Rollback Procedures

## Prerequisites

- Docker and Docker Compose installed
- PostgreSQL client tools
- Redis client tools
- Discord bot token and application secrets
- Domain name (optional, for HTTPS)

## Environment Setup

### 1. Clone Repository
```bash
git clone <repository-url>
cd discord-bot-pro-v68
```

### 2. Create Environment File
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Discord Configuration
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here

# Database Configuration
DATABASE_URL=postgresql://bot_user:bot_password@localhost:5432/bot_db
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_redis_password

# Application Configuration
NODE_ENV=production
HEALTH_PORT=3000
LOG_LEVEL=info

# Optional: External Services
SENTRY_DSN=your_sentry_dsn
DATADOG_API_KEY=your_datadog_key
```

### 3. Initialize Database
```bash
# Start only PostgreSQL
docker-compose up -d postgres

# Wait for database to be ready
sleep 10

# Run migrations
docker-compose exec postgres psql -U bot_user -d bot_db -f /docker-entrypoint-initdb.d/001_initial_schema.sql
```

## Local Development

### Start All Services
```bash
docker-compose --profile dev up -d
```

### View Logs
```bash
# Bot logs
docker-compose logs -f discord-bot

# Database logs
docker-compose logs -f postgres

# Redis logs
docker-compose logs -f redis
```

### Access Services
- **Bot Health Check**: http://localhost:3000/health
- **PgAdmin**: http://localhost:8080 (admin@bot.local / admin)
- **Redis**: localhost:6379

## Production Deployment

### 1. Build and Deploy
```bash
# Build production images
docker-compose build

# Deploy with zero-downtime
docker-compose up -d --scale discord-bot=2

# Wait for health checks
sleep 30

# Scale back to 1 instance
docker-compose up -d --scale discord-bot=1
```

### 2. Database Backup
```bash
# Create backup
docker-compose exec postgres pg_dump -U bot_user bot_db > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
docker-compose exec -T postgres psql -U bot_user bot_db < backup_file.sql
```

### 3. Monitoring Setup
```bash
# Health check endpoint
curl http://your-domain:3000/health

# Readiness check
curl http://your-domain:3000/ready

# Metrics endpoint (if implemented)
curl http://your-domain:3000/metrics
```

## Rollback Procedures

### Emergency Rollback
```bash
# Stop current deployment
docker-compose down

# Deploy previous version
docker-compose pull discord-bot  # Pulls previous image
docker-compose up -d

# Verify health
curl http://your-domain:3000/health
```

### Database Rollback
```bash
# Stop the bot
docker-compose stop discord-bot

# Restore database from backup
docker-compose exec -T postgres psql -U bot_user bot_db < previous_backup.sql

# Restart bot
docker-compose start discord-bot
```

### Blue-Green Deployment
```bash
# Create blue environment
docker-compose -f docker-compose.blue.yml up -d

# Test blue environment
curl http://blue.your-domain:3000/health

# Switch traffic to blue
# (Update load balancer/reverse proxy)

# Keep green as rollback option
docker-compose down  # Takes down old environment
```

## Configuration Management

### Secrets Management
- Use Docker secrets or external secret managers
- Never commit secrets to repository
- Rotate secrets regularly

### Environment Variables
```bash
# Development
NODE_ENV=development
LOG_LEVEL=debug

# Staging
NODE_ENV=staging
LOG_LEVEL=info

# Production
NODE_ENV=production
LOG_LEVEL=warn
```

## Scaling and Performance

### Horizontal Scaling
```bash
# Scale to multiple instances
docker-compose up -d --scale discord-bot=3

# Use load balancer for multiple instances
# Configure Redis for shared state
```

### Database Optimization
```bash
# Create indexes for performance
docker-compose exec postgres psql -U bot_user -d bot_db -c "
CREATE INDEX CONCURRENTLY idx_audit_guild_time ON audit_log (guild_id, timestamp);
CREATE INDEX CONCURRENTLY idx_command_executed ON command_usage (executed_at);
"
```

### Redis Clustering
For high availability, configure Redis cluster:
```yaml
# docker-compose.redis.yml
version: '3.8'
services:
  redis-cluster:
    image: redis:7-alpine
    command: redis-server /etc/redis/redis.conf
    volumes:
      - ./redis.conf:/etc/redis/redis.conf
    networks:
      - bot-network
```

## Troubleshooting

### Common Issues

#### Bot Not Starting
```bash
# Check logs
docker-compose logs discord-bot

# Check environment variables
docker-compose exec discord-bot env

# Test database connection
docker-compose exec discord-bot node -e "require('./src/app/database').databaseClient.connect().then(() => console.log('DB OK')).catch(console.error)"
```

#### Database Connection Issues
```bash
# Check database status
docker-compose exec postgres pg_isready -U bot_user -d bot_db

# Check database logs
docker-compose logs postgres

# Test connection manually
docker-compose exec postgres psql -U bot_user -d bot_db -c "SELECT version();"
```

#### Redis Connection Issues
```bash
# Check Redis status
docker-compose exec redis redis-cli ping

# Check Redis logs
docker-compose logs redis
```

### Health Checks

#### Application Health
- **HTTP 200**: Service is healthy
- **HTTP 503**: Service is not ready
- **Timeout**: Service is unresponsive

#### Database Health
```sql
-- Check connection count
SELECT count(*) FROM pg_stat_activity;

-- Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Redis Health
```bash
# Check memory usage
redis-cli info memory

# Check connected clients
redis-cli info clients

# Check key count
redis-cli dbsize
```

## Maintenance Tasks

### Regular Backups
```bash
#!/bin/bash
# Daily backup script
DATE=$(date +%Y%m%d_%H%M%S)
docker-compose exec postgres pg_dump -U bot_user bot_db > /backups/backup_$DATE.sql

# Keep only last 7 days
find /backups -name "backup_*.sql" -mtime +7 -delete
```

### Log Rotation
```bash
# Rotate application logs
docker-compose exec discord-bot logrotate /etc/logrotate.d/bot

# Archive old logs
find /logs -name "*.log" -mtime +30 -exec gzip {} \;
```

### Performance Monitoring
```bash
# Database performance
docker-compose exec postgres psql -U bot_user -d bot_db -c "
SELECT * FROM pg_stat_user_tables ORDER BY n_tup_ins + n_tup_upd + n_tup_del DESC LIMIT 10;
"

# Application metrics
curl http://localhost:3000/metrics
```

## Security Considerations

- Run containers as non-root user
- Use secrets management for sensitive data
- Regularly update base images
- Implement rate limiting and abuse protection
- Monitor for security vulnerabilities
- Use HTTPS in production
- Implement proper firewall rules

## Support and Monitoring

### Alerting
Set up alerts for:
- Bot offline/unhealthy
- Database connection issues
- High error rates
- Resource exhaustion
- Security incidents

### Logging
- Centralized logging with ELK stack or similar
- Structured logging with correlation IDs
- Log retention policies
- Log analysis and alerting

### Metrics
- Application performance metrics
- Database query performance
- Cache hit rates
- Error rates and types
- User activity metrics
