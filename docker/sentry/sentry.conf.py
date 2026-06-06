# docker/sentry/sentry.conf.py — Sentry 26.x self-hosted configuration.
# Wired to the per-env postgres, redis, clickhouse, and kafka stack.
# Mounted read-only into all sentry containers as /etc/sentry/sentry.conf.py.
from sentry.conf.server import *  # noqa: F401, F403

import os

# ── Database ──────────────────────────────────────────────────────────────
DATABASES["default"].update(
    {
        "ENGINE": "sentry.db.postgres",
        "NAME": os.environ.get("SENTRY_DB_NAME", "sentry"),
        "USER": os.environ.get("SENTRY_DB_USER", "sentry"),
        "PASSWORD": os.environ.get("SENTRY_DB_PASSWORD", "sentrypassword"),
        "HOST": os.environ.get("SENTRY_POSTGRES_HOST", "sentry-postgres"),
        "PORT": os.environ.get("SENTRY_POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 0,
    }
)

# ── Cache ─────────────────────────────────────────────────────────────────
# Django cache → Memcached. Sentry's own session/rate-limit cache → Redis DB 4.
CACHES["default"] = {
    "BACKEND": "sentry.cache.backends.reconnectingmemcache.ReconnectingMemcache",
    "LOCATION": ["sentry-memcached:11211"],
    "TIMEOUT": 3600,
    "OPTIONS": {"connect_timeout": 2},
}
SENTRY_CACHE = "sentry.cache.redis.RedisCache"

# ── Redis ─────────────────────────────────────────────────────────────────
_redis_host = os.environ.get("SENTRY_REDIS_HOST", "sentry-redis")
_redis_port = int(os.environ.get("SENTRY_REDIS_PORT", "6379"))
SENTRY_OPTIONS["redis.clusters"] = {
    "default": {
        "hosts": {
            0: {
                "host": _redis_host,
                "password": "",
                "port": str(_redis_port),
                "db": "4",
            }
        }
    }
}

# ── Redis-backed services — must override server.py base class defaults ───
# The default implementations (RateLimiter, Buffer, Quota, DummyDigests)
# raise NotImplementedError on validate() or warn as unsupported for prod.
SENTRY_RATELIMITER = "sentry.ratelimits.redis.RedisRateLimiter"
SENTRY_RATELIMITER_OPTIONS = {"cluster": "default"}

SENTRY_BUFFER = "sentry.buffer.redis.RedisBuffer"
SENTRY_BUFFER_OPTIONS = {}

SENTRY_QUOTAS = "sentry.quotas.redis.RedisQuota"
SENTRY_QUOTAS_OPTIONS = {}

SENTRY_DIGESTS = "sentry.digests.backends.redis.RedisBackend"
SENTRY_DIGESTS_OPTIONS = {"cluster": "default"}

# ── Kafka / EventStream ───────────────────────────────────────────────────
_kafka_brokers = os.environ.get("KAFKA_BROKERS", "sentry-kafka:9092")
_kafka_opts = {
    "bootstrap.servers": _kafka_brokers,
    "message.max.bytes": 50000000,
    "socket.timeout.ms": 1000,
}
SENTRY_EVENTSTREAM = "sentry.eventstream.kafka.KafkaEventStream"
SENTRY_EVENTSTREAM_OPTIONS = {"producer_configuration": _kafka_opts}
KAFKA_CLUSTERS["default"] = _kafka_opts

# ── Snuba ─────────────────────────────────────────────────────────────────
SENTRY_SEARCH = "sentry.search.snuba.EventsDatasetSnubaSearchBackend"
SENTRY_TSDB = "sentry.tsdb.redissnuba.RedisSnubaTSDB"

# ── Errors-only mode ─────────────────────────────────────────────────────
# Disables performance tracing, profiling, and session replays.
SENTRY_SELF_HOSTED_ERRORS_ONLY = True

# ── Node storage — DjangoNodeStorage stores event blobs in postgres ───────
SENTRY_NODESTORE = "sentry.nodestore.django.DjangoNodeStorage"

# ── File storage (attachments, sourcemaps) ────────────────────────────────
SENTRY_OPTIONS["filestore.backend"] = "filesystem"
SENTRY_OPTIONS["filestore.options"] = {"location": "/data/files"}

# ── Secret key ────────────────────────────────────────────────────────────
SENTRY_OPTIONS["system.secret-key"] = os.environ["SENTRY_SECRET_KEY"]

# ── Public URL (used in alert emails and issue links) ─────────────────────
SENTRY_OPTIONS["system.url-prefix"] = "http://localhost:{}".format(
    os.environ.get("SENTRY_PORT", "9000")
)
