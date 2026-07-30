/**
 * pages/accessibility.tsx
 * Public accessibility statement: WCAG 2.1 AA conformance claim, known
 * limitations, and how to report an accessibility issue.
 */

import Head from "next/head";

const LAST_AUDIT_DATE = "2026-07-29";

export default function AccessibilityStatement() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Head>
        <title>Accessibility Statement | Finchippay-Solution</title>
        <meta
          name="description"
          content="Finchippay-Solution's accessibility conformance statement, known limitations, and how to report accessibility issues."
        />
      </Head>

      <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-white">
        Accessibility Statement
      </h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Last reviewed: {LAST_AUDIT_DATE}
      </p>

      <section className="card mt-8 space-y-4">
        <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
          Conformance status
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Finchippay-Solution is committed to providing an application that is accessible
          to the widest possible audience, regardless of ability or technology. We aim to
          conform to the{" "}
          <a
            href="https://www.w3.org/TR/WCAG21/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-stellar-700 hover:underline dark:text-stellar-400"
          >
            Web Content Accessibility Guidelines (WCAG) 2.1
          </a>{" "}
          at Level AA. This is an ongoing effort — the application is{" "}
          <strong>partially conformant</strong>: most flows meet WCAG 2.1 AA, and the
          items below are tracked and actively being addressed.
        </p>
      </section>

      <section className="card mt-6 space-y-4">
        <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
          What we&apos;ve implemented
        </h2>
        <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <li>Skip-to-content link on every page for keyboard users.</li>
          <li>
            Visible focus indicators and logical tab order across forms, tables, and
            navigation.
          </li>
          <li>
            Focus trapping, initial focus placement, and Escape-to-close for all modal
            dialogs, with focus restored to the triggering element on close.
          </li>
          <li>
            A screen-reader live region (<code>aria-live</code>) announcing transaction
            confirmations, errors, toast notifications, and route changes.
          </li>
          <li>
            Arrow-key and keyboard activation support for transaction lists and other
            interactive lists.
          </li>
          <li>
            A high-contrast mode (see Settings) and color-contrast ratios audited against
            WCAG AA (≥ 4.5:1 for normal text, ≥ 3:1 for large text) in light, dark, and
            high-contrast themes.
          </li>
          <li>ARIA labels, roles, and live regions on interactive components and forms.</li>
          <li>Automated accessibility testing (axe-core) in unit tests and CI.</li>
        </ul>
      </section>

      <section className="card mt-6 space-y-4">
        <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
          Known limitations
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          We are aware of the following gaps and are actively working through them:
        </p>
        <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <li>
            Some data-dense views (analytics charts, portfolio allocation charts) do not
            yet expose an equivalent tabular/text alternative for screen reader users.
          </li>
          <li>
            A small number of third-party embedded widgets (e.g. wallet extension
            prompts) are outside our direct control and may not fully meet WCAG AA.
          </li>
          <li>
            Coverage of assistive-technology (screen reader) manual testing beyond
            automated tooling is ongoing and not yet complete for every page.
          </li>
        </ul>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          These limitations are tracked in the project&apos;s public issue tracker and
          prioritized alongside other engineering work.
        </p>
      </section>

      <section className="card mt-6 space-y-4">
        <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
          Reporting an accessibility issue
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          If you encounter an accessibility barrier while using Finchippay-Solution,
          please let us know so we can fix it. The fastest way to reach us is to open an
          issue on GitHub:
        </p>
        <a
          href="https://github.com/FinChippay/Finchippay-Solution/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary inline-flex w-fit text-sm"
        >
          Report an accessibility issue on GitHub
        </a>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          Please include the page URL, a description of the barrier, and the assistive
          technology or browser you were using, if applicable. We aim to acknowledge
          accessibility reports promptly and prioritize fixes by severity.
        </p>
      </section>

      <section className="card mt-6 space-y-4">
        <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
          Assessment approach
        </h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          This statement is based on an automated audit using{" "}
          <code>@axe-core/playwright</code> and <code>jest-axe</code> against WCAG 2.1 A
          and AA rules, combined with manual keyboard-navigation and screen-reader spot
          checks, most recently performed on {LAST_AUDIT_DATE}.
        </p>
      </section>
    </div>
  );
}
