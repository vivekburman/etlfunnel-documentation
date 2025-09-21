import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
    // Manual sidebar configuration with your specified sections
    tutorialSidebar: [
        {
            type: 'category',
            label: 'Getting Started',
            items: ['intro', 'setup-guide'],
        },
        {
            type: 'category',
            label: 'Connectors',
            items: ['connector-hub', 'connector-entity'],
        },
        {
            type: "category",
            label: "Hooks",
            items: ['transformer-hook', 'checkpoint-hook', 'backlog-hook']
        },
        {
            type: 'category',
            label: 'Resources',
            items: ['resource-flow', 'resource-collection', 'user-libraries'],
        },
        {
            type: "category",
            label: "Executions",
            items: ['creating-a-new-build', 'integration-webhook']
        },
        {
            type: "category",
            label: "Code References",
            items: [
                {
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
                    type: 'category',
                    label: 'Non-Relational DB',
                    items: [
                        'nosql-elasticsearch',
                        'nosql-mongo',
                        'nosql-redis'
                    ],
                },
            ]
        }
    ],
};


export default sidebars;