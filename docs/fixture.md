# Fixtures

Fixtures define setup and teardown logic that runs once before a flow starts and once after it completes. They are the right place for one-time operations that the pipeline itself should not own — creating tables, seeding configuration data, verifying preconditions, or cleaning up temporary state.

## Overview

A fixture is attached to a flow at the flow definition level via two optional slots:

- **Setup Fixture** — runs before any pipeline in the flow begins processing
- **Teardown Fixture** — runs after all pipelines in the flow have finished

Because fixtures execute outside the pipeline loop, they have access to the same database connections as the flow but are not subject to per-record semantics. A fixture either succeeds and lets the flow proceed, or returns an error and halts execution.

## Fixture Types

| Type | Value | When it runs |
|------|-------|--------------|
| **Setup** | `1` | Once before the flow starts |
| **Teardown** | `2` | Once after the flow completes |

## Fixture Specification

The function name matches the fixture type. A Setup fixture must export `Setup`; a Teardown fixture must export `Teardown`.

```go
// Setup fixture
func Setup(param *models.FixtureProps) error

// Teardown fixture
func Teardown(param *models.FixtureProps) error
```

### Parameters

```go
type FixtureProps struct {
	SourceDBConn       models.IDatabaseConnInfo
	DestDBConn         models.IDatabaseConnInfo
	AuxiliaryDBConnMap map[string]models.IDatabaseConnInfo
}
```

### Return Value

Return `nil` to allow the flow to proceed. Return a non-nil `error` to halt execution — for a Setup fixture this prevents the flow from starting; for a Teardown fixture it signals that cleanup failed.

### Referenced Types

```go
type IDatabaseConnInfo interface {
	GetName() string
	IsConnectionError(err error) bool
}
```

`IDatabaseConnInfo` is the read-only view of a database connection handed to client-authored code. It exposes identity and error-classification only — connection lifecycle (`Connect`/`Close`) is owned exclusively by the system and is never exposed to fixtures or any other client-facing code.

## Implementation Example

### Setup — ensure required tables exist before the flow runs

```go
import (
	"context"
	castpostgres "etlfunnel/execution/cast/postgres"
	"etlfunnel/execution/models"
	"fmt"
)

func Setup(param *models.FixtureProps) error {
	conn, err := castpostgres.CastAsPostgresConnection(param.AuxiliaryDBConnMap["audit_db"])
	if err != nil {
		return fmt.Errorf("fixture setup: connect auxdb: %w", err)
	}

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS ingestion_cursors (
			pipeline   TEXT PRIMARY KEY,
			last_cursor TEXT NOT NULL,
			updated_at  TIMESTAMPTZ NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS ingestion_backlog (
			id             BIGSERIAL PRIMARY KEY,
			pipeline       TEXT NOT NULL,
			record_payload JSONB,
			failure_stage  TEXT,
			error_message  TEXT,
			created_at     TIMESTAMPTZ NOT NULL
		)`,
	}

	for _, stmt := range stmts {
		if _, err := conn.Exec(context.Background(), stmt); err != nil {
			return fmt.Errorf("fixture setup: ddl exec: %w", err)
		}
	}

	return nil
}
```

### Teardown — clean up temporary state after the flow completes

```go
import (
	"context"
	castpostgres "etlfunnel/execution/cast/postgres"
	"etlfunnel/execution/models"
	"fmt"
)

func Teardown(param *models.FixtureProps) error {
	conn, err := castpostgres.CastAsPostgresConnection(param.AuxiliaryDBConnMap["audit_db"])
	if err != nil {
		return fmt.Errorf("fixture teardown: connect auxdb: %w", err)
	}

	_, err = conn.Exec(context.Background(), `DELETE FROM ingestion_cursors WHERE updated_at < NOW() - INTERVAL '7 days'`)
	if err != nil {
		return fmt.Errorf("fixture teardown: cleanup: %w", err)
	}

	return nil
}
```

## Creating a Fixture

1. Navigate to **Fixtures** in the left navigation panel
2. Click **Create New** and provide a unique name
3. Select the fixture type — **Setup** or **Teardown**
4. Implement the corresponding function (`Setup` or `Teardown`) in the code editor
5. Attach the fixture to a flow via the flow's **Setup Fixture** or **Teardown Fixture** slot

## Best Practices

- **Keep fixtures idempotent**: Use `CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, etc. so re-runs do not fail
- **Fail fast on Setup**: If a precondition cannot be met, return an error immediately — it is safer to prevent the flow from starting than to let it run against missing infrastructure
- **Keep Teardown non-critical where possible**: Teardown failures should be logged but ideally should not mask the fact that the flow itself succeeded
- **Use Auxiliary Hubs for side-effect storage**: Keep setup/teardown writes out of the primary source and destination connections
