# Quickstart: Your First Pipeline

In this walkthrough you build a pipeline that reads orders from one PostgreSQL database, totals them by day, and writes the totals into another. You run it, then send it through review. It assumes the [server and a runner are set up](./setup-guide), and that you have two PostgreSQL databases to play with. They can be two databases on the same server.

Sign in as `admin`. As the super user you can both submit and approve your own change set, which a normal account cannot; that is why a one-person trial works at all. In a real team, a second person approves.

## The shape of what you are building

```
Hub (source DB) ──► Source connector entity ──► Pipeline ──► Destination connector entity ──► Hub (destination DB)
                         your query                                  your upsert
                                         └───────────── Flow ──────────────┘
```

A **hub** holds a database connection. A **connector entity** is the code that reads from or writes to it. A **pipeline** joins one source entity to one destination entity. A **flow** holds the pipelines that share a source and a destination connector.

## 1. Create a workspace

Everything lives in a workspace. Open the settings from the top-right menu, find **Workspace**, and choose **Create Workspace**. Name it, for example, `Shopfront`. As the super user you can open it straight away.

## 2. Register two hubs

Open **Builder › Hub**. The hub screen has three tabs, **Shared**, **Staging** and **Production**. Stay on **Shared**, the hubs your dev work uses. Create a PostgreSQL hub for each database, for example `orders-dev` and `reporting-dev`, and use **Test connection** on each. Details for every field are in [Connector Hub](./connector-hub).

Your source database needs an `orders` table with `created_at` and `total` columns. Your destination needs:

```sql
CREATE TABLE daily_sales (
    day     date PRIMARY KEY,
    orders  bigint,
    revenue numeric
);
```

## 3. Write the source and destination

Open **Connector › SQL** and create two PostgreSQL connectors, one with the **source** context and one with **destination**. Inside each, create a connector entity. Each opens a code editor, where you write the body of the entity. The editor adds the package line for you.

The source returns a query. ETLFunnel runs it and streams the rows into the pipeline:

```go
import (
	"etlfunnel/execution/core/coreinterface"
	"etlfunnel/execution/models"
)

type IUseConnector struct{}

var _ coreinterface.IClientDBPostgresSource = (*IUseConnector)(nil)

func (d *IUseConnector) FetchRecords(param *models.PostgresSourceFetch) <-chan *models.Record {
	panic("unimplemented")
}

func (d *IUseConnector) GenerateQuery(param *models.PostgresSourceQuery) (*models.PostgresSourceQueryOptions, error) {
	return &models.PostgresSourceQueryOptions{Query: `
		SELECT created_at::date AS day, count(*) AS orders, sum(total) AS revenue
		FROM orders
		GROUP BY 1`}, nil
}

func (d *IUseConnector) GenerateNotification(param *models.PostgresSourceNotification) (*models.PostgresSourceNotificationOptions, error) {
	panic("unimplemented")
}

func (d *IUseConnector) GenerateWAL(param *models.PostgresSourceWAL) (*models.PostgresSourceWALOptions, error) {
	panic("unimplemented")
}
```

The destination turns each batch of records into SQL. An upsert means rerunning the pipeline replaces a day instead of failing:

```go
import (
	"etlfunnel/execution/core/coreinterface"
	"etlfunnel/execution/models"
)

type IUseConnector struct{}

var _ coreinterface.IClientDBPostgresDest = (*IUseConnector)(nil)

func (d *IUseConnector) GenerateQuery(param *models.PostgresDestQuery) ([]*models.PostgresDestQueryPayload, error) {
	out := make([]*models.PostgresDestQueryPayload, 0, len(param.Records))
	for _, r := range param.Records {
		out = append(out, &models.PostgresDestQueryPayload{
			Query: `INSERT INTO daily_sales (day, orders, revenue) VALUES ($1, $2, $3)
			        ON CONFLICT (day) DO UPDATE SET orders = EXCLUDED.orders, revenue = EXCLUDED.revenue`,
			Value: []any{r.Data["day"], r.Data["orders"], r.Data["revenue"]},
		})
	}
	return out, nil
}

func (d *IUseConnector) GenerateOptions(param *models.PostgresDestQuery) (*models.PostgresDestOptions, error) {
	return &models.PostgresDestOptions{}, nil
}
```

The full interfaces, with the other ways to read data (change streams, notifications), are in [PostgreSQL](./sql-postgres) and [Connector Entity](./connector-entity).

## 4. Build the flow

Open **Builder › Flow** and create a flow. Give it the source and destination connectors from the last step. Add a pipeline, name it `daily_sales`, and choose the source entity and destination entity you wrote. You do not need a transformer for this one. When you do, [Transformer](./transformer-hook) shows how to add one.

Notice what you did not choose: a hub. A flow names no database. Where it runs decides which database it uses.

## 5. Run it from your draft

Nothing you have saved is live yet. Every save so far is a **draft**, private to you and gathered in one **change set**. You can still run it. Run the flow and, in the run window, choose **Run from: Draft**. Pick your `orders-dev` hub as the source and `reporting-dev` as the destination, and choose your runner.

Open **Executions › Result** to watch the run and read its logs. Query the `daily_sales` table to see the rows. The settings in the run window are explained in [Creating a New Build](./creating-a-new-build).

If it fails, the log carries an `EF-` code with a plain explanation. See [Error Codes](./ef-codes).

## 6. Send it for review

When it works, use **Submit for review** from the change set panel in the toolbar. Add a note. As the super user you can submit without choosing a reviewing group. Then open the change set from the **Change sets** panel, choose **Review**, and choose **Approve and merge**. Your pipeline is now part of **dev**, the approved version everyone else sees.

In a team, a second person reviews and approves, and the author cannot approve their own set. See [Drafts and Change Sets](./drafts-and-change-sets).

## 7. What comes next

You have done the first half of the story: making a change. The second half is shipping it.

- **Cut a package** from dev, a frozen snapshot of the workspace.
- **Create staging hubs and bindings**, so the flow knows which databases to use in Staging.
- **Promote, run and approve** it in Staging, then do the same in Production, where a different person approves.

That path is covered in [How a Change Reaches Production](./delivery-overview). To run the pipeline on a timer, see [Schedules](./schedules).
