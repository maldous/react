# Reset and fixture data

Local Postgres and Redis are Compose-managed. All reset targets operate on the local Compose instance only.

## Idempotent operations (safe to run anytime)

```bash
make db-migrate    # Apply pending migrations (tracked in schema_migrations table)
make seed-demo     # Seed fixture users and organisation (ON CONFLICT DO NOTHING)
```

## Destructive operations (require local Compose running)

```bash
make reset-local       # Drop all tables + re-migrate + re-seed
make redis-flush-local # Clear all Redis keys (invalidates all sessions)
```

## Database shell

```bash
make db-shell   # Opens psql against local Compose Postgres
```

## Fixture actors

Seeded by `apps/platform-api/src/db/seed.ts`:

| Actor          | Email                     | Role         | UUID                                 |
| -------------- | ------------------------- | ------------ | ------------------------------------ |
| Fixture Admin  | `admin@fixture.local`     | tenant-admin | 00000000-0000-0000-0000-000000000002 |
| Fixture Viewer | `viewer@fixture.local`    | viewer       | 00000000-0000-0000-0000-000000000003 |
| No Membership  | `forbidden@fixture.local` | (none)       | 00000000-0000-0000-0000-000000000004 |

Fixture organisation: `fixture-org` (id: `00000000-0000-0000-0000-000000000001`)

## Idempotency

- Migrations: tracked in `schema_migrations` table with checksums ? running twice applies nothing new
- Seed: uses `ON CONFLICT (id) DO NOTHING` for all inserts ? safe to run multiple times
- `make reset-local` is destructive but produces identical state every run
