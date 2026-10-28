import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
    tutorialSidebar: [
        {
            collapsed: false,
            type: 'category',
            label: '1 · Start here',
            items: ['intro', 'setup-guide', 'quickstart', 'architecture', 'runner'],
        },
        {
            collapsed: true,
            type: 'category',
            label: '2 · Build',
            items: [
                'connector-hub',
                'resource-flow',
                'flow-graph-view',
                'resource-collection',
                'connector-entity',
                'transformer-hook',
                'user-libraries',
            ],
        },
        {
            collapsed: true,
            type: 'category',
            label: '3 · Shape how it runs',
            items: [
                'resource-orchestrator',
                'fixture',
                'destination-write-tune-hook',
                'termination-rule-hook',
                'checkpoint-hook',
                'backlog-hook',
            ],
        },
        {
            collapsed: true,
            type: 'category',
            label: '4 · Run and watch',
            items: ['creating-a-new-build', 'running-while-you-develop', 'ef-codes'],
        },
        {
            collapsed: true,
            type: 'category',
            label: '5 · Work as a team',
            items: ['workspaces', 'roles-and-permissions', 'drafts-and-change-sets', 'notifications'],
        },
        {
            collapsed: true,
            type: 'category',
            label: '6 · Ship it',
            items: ['delivery-overview', 'packages', 'stages', 'sign-off', 'schedules', 'rolling-back'],
        },
        {
            collapsed: true,
            type: 'category',
            label: '7 · Automate',
            items: ['integration-webhook', 'mcp'],
        },
        {
            collapsed: true,
            type: 'category',
            label: '8 · Connector reference',
            link: { type: 'doc', id: 'connector-catalog' },
            items: [
                {
                    collapsed: true,
                    type: 'category',
                    label: 'Relational DB',
                    items: [
                        'sql-mysql',
                        'sql-maria',
                        'sql-postgres',
                        'sql-oracle',
                        'sql-microsoft',
                    ],
                },
                {
                    collapsed: true,
                    type: 'category',
                    label: 'Non-Relational DB',
                    items: [
                        'nosql-cassandra',
                        'nosql-elasticsearch',
                        'nosql-kafka',
                        'nosql-mongo',
                        'nosql-redis',
                        'nosql-rabbitmq',
                    ],
                },
                {
                    collapsed: true,
                    type: 'category',
                    label: 'APIs',
                    items: [
                        'restapi',
                    ],
                },
                {
                    collapsed: true,
                    type: 'category',
                    label: 'File-Based',
                    items: [
                        'file-csv',
                        'file-json',
                        'file-excel',
                        'file-parquet',
                        'file-avro',
                        'file-fixedwidth',
                    ],
                },
                {
                    collapsed: true,
                    type: 'category',
                    label: 'Data Warehouse',
                    items: [
                        'dw-snowflake',
                        'dw-redshift',
                        'dw-bigquery',
                    ],
                },
                {
                    collapsed: true,
                    type: 'category',
                    label: 'Object Storage',
                    items: [
                        's3',
                        'gcs',
                    ],
                },
            ],
        },
    ],
};

export default sidebars;
