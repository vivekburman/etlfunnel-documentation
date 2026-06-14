import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
    tutorialSidebar: [
        {
            collapsed: false,
            type: 'category',
            label: 'Getting Started',
            items: ['intro', 'architecture', 'setup-guide'],
        },
        {
            collapsed: false,
            type: 'category',
            label: 'Builder',
            items: ['connector-hub', 'resource-flow', 'resource-collection'],
        },
        {
            collapsed: false,
            type: 'category',
            label: 'Data Plane',
            items: [
                'connector-entity',
                'transformer-hook',
                'user-libraries',
            ],
        },
        {
            collapsed: false,
            type: 'category',
            label: 'Control Plane',
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
            collapsed: false,
            type: 'category',
            label: 'Executions',
            items: ['creating-a-new-build', 'integration-webhook'],
        },
        {
            collapsed: true,
            type: 'category',
            label: 'Code Reference',
            items: [
                {
                    collapsed: false,
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
                    collapsed: false,
                    type: 'category',
                    label: 'Non-Relational DB',
                    items: [
                        'nosql-cassandra',
                        'nosql-elasticsearch',
                        'nosql-kafka',
                        'nosql-mongo',
                        'nosql-redis',
                    ],
                },
                {
                    collapsed: false,
                    type: 'category',
                    label: 'APIs',
                    items: [
                        'restapi',
                    ],
                },
            ],
        },
    ],
};

export default sidebars;