# External MySQL and Redis

The Hub ships with a bundled `docker-compose.yml` stack. Larger installations
often run one MySQL server and one Redis server for several projects; the Hub
can use those servers instead of starting its own containers.

## Contract

| Setting | Requirement |
| --- | --- |
| `DSC_DB_MODE` | `external` |
| `MYSQL_URL` | `mysql://user:password@host:3306/database` |
| `REDIS_URL` | `redis://:password@host:6379/N` or `rediss://...` |
| `DSC_INSTANCE_ID` | Unique value per Hub; external mode rejects `default` (bundled/legacy keeps `dsc:*`) |
| MySQL | 8.0 or newer; the Hub needs `CREATE`, `ALTER`, `INDEX`, `DROP`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` on its own database |
| Redis | Authentication enabled; an AOF-backed server is recommended |

**One MySQL database per Hub.** Table names are fixed, so two Hubs must not
share a database. The Hub writes its instance id into `hub_meta` and refuses to
start when the database belongs to another instance. Changing
`DSC_INSTANCE_ID` after the first start is a data migration: use a new database,
or update `hub_meta.instance_id` explicitly while the Hub is stopped.

**One Redis namespace per Hub.** External mode requires a non-default
`DSC_INSTANCE_ID`; it prefixes every device, series, expiry and cache key with
`dsc:<instance-id>`. Different
applications may share one Redis server as long as their prefixes and eviction
policies do not conflict. Redis Cluster and Sentinel URLs are not supported by
the current single-node client.

The Hub is a single-writer design. Do not run two Hub processes against the same
database or the same Redis namespace. External mode holds a MySQL advisory lock
for the process lifetime, so a second Hub on the same database is refused even
when both use the same instance id. It is not a high-availability or
leader-election system.

## Deploy

Start only the Hub application containers:

```bash
cp .env.example .env
# edit .env:
#   DSC_DB_MODE=external
#   MYSQL_URL=mysql://guanlan:...@db.internal:3306/guanlan_home
#   REDIS_URL=rediss://:...@redis.internal:6379/3
#   DSC_INSTANCE_ID=hub-home

DSC_VERSION=3.0.170 docker compose -f docker-compose.external.yml pull
DSC_VERSION=3.0.170 docker compose -f docker-compose.external.yml up -d
```

`docker-compose.external.yml` contains only `server` and `web`; it does not
create MySQL or Redis and does not publish their ports. Keep the database and
Redis on a private network or VPN; never expose them to the internet.

If you need the CN image mirror, set `DSC_SERVER_IMAGE_REF` and
`DSC_WEB_IMAGE_REF` explicitly. Do not combine this file with
`docker-compose.cn.yml`: that override re-declares the bundled `mysql` and
`redis` services.

The bundled `docker-compose.yml` remains the default. The production deployment
workflow reads `DSC_DB_MODE` from the existing `.env`, preserves the URLs, and
skips starting the local `mysql`/`redis` services in external mode. Do not run
the automated deployment against an external `MYSQL_URL` until the target
`.env` and the database grants have been prepared.

### Cloud-init for MySQL

```sql
CREATE DATABASE guanlan_home CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'guanlan'@'10.%' IDENTIFIED BY '<strong-password>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP
  ON guanlan_home.* TO 'guanlan'@'10.%';
```

The application creates its tables and indexes automatically. The session time
zone must remain UTC; the Hub pins every pooled connection and checks the
session zone at startup. A non-UTC MySQL server default is tolerated because of
that pin, but do not override it in a proxy or connection pool.

### Redis

```conf
requirepass <strong-password>
appendonly yes
maxmemory-policy volatile-lru
```

The Hub uses Redis for realtime state and short series. If you enable the
optional L2 read cache (`DSC_REDIS_CACHE_ENABLED=true`), its keys carry a TTL;
`volatile-lru` lets Redis evict cache entries before the non-volatile realtime
keys. For multiple applications sharing one server, monitor `maxmemory` and use
separate logical databases or key prefixes.

## Move from the bundled database

1. Stop the old stack after taking a backup:
   `docker compose exec -T mysql mysqldump ... > guanlan.sql`
2. Restore into the external database.
3. Set the external values and `DSC_INSTANCE_ID` in `.env`.
4. Start `docker-compose.external.yml` and verify `/api/health/readiness`.
5. Keep the old volumes until the new stack has served a full retention cycle.

Redis realtime state can be rebuilt from heartbeats; the durable history lives
in MySQL. `data/local-db.json` still holds metric configuration, fan notes and
agent credentials; moving MySQL does not move those files.

## Remote latency

`MYSQL_POOL_SIZE`, `MYSQL_CONNECT_TIMEOUT_MS`, `MYSQL_QUERY_TIMEOUT_MS`,
`MYSQL_IDLE_TIMEOUT_MS`, `REDIS_CONNECT_TIMEOUT_MS` and
`REDIS_COMMAND_TIMEOUT_MS` bound remote work. History reads use a bounded
in-process TTL cache (`DSC_HISTORY_CACHE_TTL_MS`,
`DSC_CALENDAR_CACHE_TTL_MS`, `DSC_CACHE_MAX_ENTRIES`,
`DSC_CACHE_MAX_BYTES`). `DSC_REDIS_CACHE_ENABLED=true` adds a shared L2 cache;
the L1 cache remains active if Redis fails. Current-bucket overlays are applied
after the cache, so a short TTL cannot make the live minute stale.

The traffic-calendar endpoint deliberately queries only timestamp and counter
columns. Do not add hardware-detail columns to that read path: 90 days of
minute rows would otherwise transfer the full hardware document per row.
