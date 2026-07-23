/**
 * pages/_document.tsx
 * Custom document for adding manifest link and PWA meta tags
 */

import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en" suppressHydrationWarning>
      <Head>
        {/* Resolve the saved theme before React loads to prevent a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const saved = localStorage.getItem('finchippay:theme');
                  const theme =
                    saved === 'light' || saved === 'dark' || saved === 'system'
                      ? saved
                      : 'system';
                  const resolved =
                    theme === 'system'
                      ? window.matchMedia('(prefers-color-scheme: dark)').matches
                        ? 'dark'
                        : 'light'
                      : theme;

                  document.documentElement.classList.toggle(
                    'dark',
                    resolved === 'dark'
                  );
                  document.documentElement.dataset.theme = theme;
                  document.documentElement.style.colorScheme = resolved;
                } catch (e) {}
              })();
            `,
          }}
        />

        {/* PWA Manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Theme color for browser UI - defaults to light theme color */}
        <meta name="theme-color" content="#f0f6ff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#050a1a" media="(prefers-color-scheme: dark)" />

        {/* Apple Touch Icon */}
        <link rel="apple-touch-icon" href="/icon-192.png" />

        {/* Apple mobile web app capable */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Finchippay" />

        {/* MS Tile Color */}
        <meta name="msapplication-TileColor" content="#7B3FE4" />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
