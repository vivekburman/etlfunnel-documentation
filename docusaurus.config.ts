import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)
const isProd = process.env.NODE_ENV === 'production';
const config: Config = {
	title: 'ETLFunnel Documentation',
	tagline: 'Build, review and ship data pipelines you own',
	favicon: 'img/favicon.ico',

	// Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
	future: {
		v4: true, // Improve compatibility with the upcoming Docusaurus v4
	},

	// Set the production url of your site here
	url: 'https://etlfunnel.com',
	// Set the /<baseUrl>/ pathname under which your site is served
	// For GitHub pages deployment, it is often '/<projectName>/'
	baseUrl: isProd ? '/docs/' : '/',
	trailingSlash: false,

	// GitHub pages deployment config.
	// If you aren't using GitHub pages, you don't need these.
	organizationName: 'etlfunnel', // Usually your GitHub org/user name.
	projectName: 'etlfunnel-documentation', // Usually your repo name.

	onBrokenLinks: 'throw',
	onBrokenMarkdownLinks: 'warn',

	// Even if you don't use internationalization, you can use this field to set
	// useful metadata like html lang. For example, if your site is Chinese, you
	// may want to replace "en" with "zh-Hans".
	i18n: {
		defaultLocale: 'en',
		locales: ['en'],
	},

	stylesheets: [
		{ href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&display=swap', type: 'text/css' },
	],

	plugins: [
		['@docusaurus/plugin-client-redirects', {
			redirects: [
				{ from: '/stages-and-promotion', to: '/stages' },
			],
		}],
	],

	presets: [
		[
			'classic',
			{
				docs: {
					routeBasePath: "/",
					lastVersion: "current",
					sidebarPath: './sidebars.ts',
				},
				blog: {
					showReadingTime: true,
					feedOptions: {
						type: ['rss', 'atom'],
						xslt: true,
					},
					// Useful options to enforce blogging best practices
					onInlineTags: 'warn',
					onInlineAuthors: 'warn',
					onUntruncatedBlogPosts: 'warn',
				},
				theme: {
					customCss: './src/css/custom.css',
				},
			} satisfies Preset.Options,
		],
	],
	themeConfig: {
		docs: {
			sidebar: {
				autoCollapseCategories: false,
			}
		},
		colorMode: {
			defaultMode: 'light',
			disableSwitch: false,
			respectPrefersColorScheme: false,
		},
		// Replace with your project's social card
		image: 'img/docusaurus-social-card.jpg',
		navbar: {
			title: 'ETLFunnel',
			logo: {
				alt: 'ETLFunnel',
				src: 'img/logo.svg',
				href: "https://etlfunnel.com"
			},
			items: [
				{ to: '/intro', label: 'Docs', position: 'left', activeBaseRegex: '^/(docs/)?(intro|setup-guide|architecture|runner)$' },
				{ to: '/quickstart', label: 'Quickstart', position: 'left', activeBaseRegex: '^/(docs/)?quickstart$' },
				{ to: '/delivery-overview', label: 'Ship it', position: 'left', activeBaseRegex: '^/(docs/)?(delivery-overview|packages|stages|sign-off|schedules|rolling-back)$' },
				{ to: '/connector-catalog', label: 'Connectors', position: 'left', activeBaseRegex: '^/(docs/)?(connector-catalog|sql-|nosql-|file-|dw-|restapi|s3|gcs)' },
				{ href: 'https://etlfunnel.com', label: 'etlfunnel.com', position: 'right', className: 'nav-cta' },
			],
		},
		footer: {
			style: 'light',
			links: [
				{ title: 'Start', items: [
					{ label: 'What is ETLFunnel?', to: '/intro' },
					{ label: 'Setup guide', to: '/setup-guide' },
					{ label: 'Quickstart', to: '/quickstart' },
				] },
				{ title: 'Build', items: [
					{ label: 'Flows', to: '/resource-flow' },
					{ label: 'Connector catalog', to: '/connector-catalog' },
					{ label: 'Error codes', to: '/ef-codes' },
				] },
				{ title: 'Ship', items: [
					{ label: 'How a change reaches production', to: '/delivery-overview' },
					{ label: 'Packages', to: '/packages' },
					{ label: 'Sign-off', to: '/sign-off' },
				] },
			],
			copyright: `ETLFunnel is licensed under the Elastic License 2.0.`,
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.dracula,
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
