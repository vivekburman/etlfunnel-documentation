import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

const STORY = [
  { n: '01', title: 'Start here', text: 'What ETLFunnel is, how the server and runners fit, and a first pipeline running in minutes.', to: '/intro' },
  { n: '02', title: 'Build', text: 'Hubs, flows, collections, transformers and libraries: the pipeline itself.', to: '/connector-hub' },
  { n: '03', title: 'Shape how it runs', text: 'Orchestrators, fixtures and the hooks that control delivery, stopping and failure.', to: '/resource-orchestrator' },
  { n: '04', title: 'Run and watch', text: 'Builds, schedules, runners and the error codes that explain what went wrong.', to: '/creating-a-new-build' },
  { n: '05', title: 'Work as a team', text: 'Workspaces, roles, drafts and reviewed change sets.', to: '/workspaces' },
  { n: '06', title: 'Ship it', text: 'Packages, stages and sign-off: how a change reaches production.', to: '/delivery-overview' },
  { n: '07', title: 'Automate', text: 'Slack and Teams webhooks, and driving ETLFunnel from an AI assistant over MCP.', to: '/integration-webhook' },
  { n: '08', title: 'Connector reference', text: 'The exact interfaces and settings for each of the 23 connectors.', to: '/connector-catalog' },
];

const CONNECTORS = [
  'MySQL', 'MariaDB', 'PostgreSQL', 'SQL Server', 'Oracle', 'Redis', 'MongoDB', 'Elasticsearch', 'Cassandra', 'Kafka', 'RabbitMQ',
  'REST API', 'CSV', 'JSON', 'Excel', 'Parquet', 'Avro', 'Fixed width', 'Snowflake', 'Redshift', 'BigQuery', 'Amazon S3', 'Google Cloud Storage',
];

const STAGES = ['Draft', 'Review', 'Dev', 'Package', 'Staging', 'Production'];

export default function Home(): React.ReactElement {
  return (
    <Layout title="ETLFunnel Documentation" description="Build, review and ship data pipelines you own.">
      <header className={styles.hero}>
        <div className={styles.wrap}>
          <div className={styles.heroGrid}>
            <div>
              <div className={styles.eyebrow}>Self-hosted · Developer-first</div>
              <h1 className={styles.title}>Pipelines you write, <em>review and ship</em> like code.</h1>
              <p className={styles.lede}>
                ETLFunnel is a self-hosted data pipeline platform. You write each step in Go, in a browser editor. It runs on your
                infrastructure, and a change reaches production only after a teammate has reviewed it and a person has signed it off.
              </p>
              <div className={styles.cta}>
                <Link className={styles.primary} to="/quickstart">Build your first pipeline</Link>
                <Link className={styles.ghost} to="/intro">What is ETLFunnel?</Link>
              </div>
            </div>
            <div className={styles.panel} aria-hidden="true">
              <div className={styles.panelBar}><span /><span /><span /><b>daily_sales · source entity</b></div>
              <pre className={styles.code}>{`func (d *IUseConnector) GenerateQuery(
    p *models.PostgresSourceQuery,
) (*models.PostgresSourceQueryOptions, error) {
    q := \`SELECT created_at::date AS day,
                 count(*)         AS orders,
                 sum(total)       AS revenue
          FROM orders GROUP BY 1\`
    return &models.PostgresSourceQueryOptions{Query: q}, nil
}`}</pre>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.band} aria-label="Supported connectors">
          <div className={styles.wrap}>
            <div className={styles.chips}>
              {CONNECTORS.map(c => <span key={c} className={styles.chip}>{c}</span>)}
            </div>
            <p className={styles.bandNote}>23 connectors, each with its own source and destination interface. <Link to="/connector-catalog">See the catalog</Link>.</p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.wrap}>
            <div className={styles.eyebrow}>The docs, in the order you need them</div>
            <h2 className={styles.h2}>One story, from first install to production.</h2>
            <div className={styles.grid}>
              {STORY.map(s => (
                <Link key={s.n} to={s.to} className={styles.card}>
                  <span className={styles.num}>{s.n}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.wrap}>
            <div className={styles.eyebrow}>How a change reaches production</div>
            <h2 className={styles.h2}>Nothing goes live on one person's say-so.</h2>
            <ol className={styles.path}>
              {STAGES.map((s, i) => <li key={s} className={i >= 4 ? styles.hot : undefined}>{s}</li>)}
            </ol>
            <p className={styles.pathNote}>
              A teammate reviews every change before it merges. A package is a frozen snapshot of the workspace. Each stage runs it
              against its own databases, and its owner signs it off; a different person signs off in production.{' '}
              <Link to="/delivery-overview">Read the full path</Link>.
            </p>
          </div>
        </section>
      </main>
    </Layout>
  );
}
