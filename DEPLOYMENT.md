# Deployment Guide

This guide covers environment setup, Docker Compose deployment, database migration, monitoring, and rollback for `discord-bot-pro-v68`.

## Prerequisites

- Docker and Docker Compose installed
- Node.js >= 22.12.0 for local development
- FFmpeg installed for music playback
- Discord bot token and application client credentials
- PostgreSQL and Redis when running with Docker Compose

---

## Repository Setup

```bash
git clone <repository-url>
cd discord-bot-pro-v68
```

Copy the environment template:

```bash
cp .env.example .env
```

Edit `.env` and fill values for:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `REDIS_PASSWORD`
- `REDIS_URL`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `PGADMIN_PASSWORD`
- `GRAFANA_PASSWORD`

The project already includes Docker Compose service names, so use these values for Docker:

```env
REDIS_URL=redis://:your_redis_password@redis:6379
DATABASE_URL=postgresql://bot_user:your_postgres_password@postgres:5432/bot_db
```

---

## Docker Compose Profiles

The repository uses three deployment profiles:

- `bot` — Discord bot service
- `dev` — pgAdmin service for local development
- `monitoring` — Prometheus and Grafana

### Start bot only

```bash
docker compose --profile bot up -d
```

### Start bot + pgAdmin for development

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile bot --profile dev up -d
```

### Start monitoring

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile monitoring up -d
```

### Start bot, local dev, and monitoring together

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile bot --profile dev --profile monitoring up -d
```

---

## Database Initialization and Migration

The PostgreSQL service mounts `./migrations` into the container init directory.

On first startup, the database is initialized automatically from `migrations/`.

For later migration runs:

```bash
npm run migrate
```

To view migration status:

```bash
npm run migrate:status
```

To run a dry-run migration:

```bash
npm run migrate:dry-run
```

---

## Running the Bot

### Single-instance mode

```bash
npm start
```

### Sharded mode

```bash
npm run start:shard
```

### Health and diagnostics

```bash
npm run doctor
```

---

## Slash Command Deployment

For fast testing in one guild:

```bash
npm run deploy:guild
```

For global registration:

```bash
npm run deploy:global
```

To clear guild commands:

```bash
npm run deploy:clear-guild
```

> Guild deployment updates instantly. Global command propagation may take 1-2 hours.

---

## Monitoring and Service Access

- Bot health check: `http://localhost:3000/health`
- PgAdmin: `http://localhost:8080`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

Grafana credentials are configured with `GF_SECURITY_ADMIN_USER=admin` and password from `GRAFANA_PASSWORD`.

---

## Backup and Restore

### Backup database

```bash
docker compose exec postgres pg_dump -U bot_user bot_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore database

```bash
docker compose exec -T postgres psql -U bot_user bot_db < backup_file.sql
```

---

## Scaling and Rollback

### Scale the bot service

```bash
docker compose up -d --scale discord-bot=2
```

### Rollback the bot

```bash
docker compose down
docker compose up -d
```

### Emergency database rollback

```bash
docker compose stop discord-bot
docker compose exec -T postgres psql -U bot_user bot_db < previous_backup.sql
docker compose start discord-bot
```

---

## Troubleshooting

### Check service logs

```bash
docker compose logs -f discord-bot
```

### Confirm Redis

```bash
docker compose exec redis redis-cli -a "$env:REDIS_PASSWORD" ping
```

### Confirm PostgreSQL

```bash
docker compose exec postgres pg_isready -U bot_user -d bot_db
```

### Common fixes

- Ensure `.env` values are correct and not committed to source control.
- Confirm Docker uses `.env` if `env_file` is configured.
- Verify `REDIS_URL` and `DATABASE_URL` use the Docker service names `redis` and `postgres`.

---

## Notes

- `docker-compose.dev.yml` exposes host ports for local development only.
- `docker-compose.yml` omits host port bindings for production-safe deployment.
- Do not commit `.env` or secret values.
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
