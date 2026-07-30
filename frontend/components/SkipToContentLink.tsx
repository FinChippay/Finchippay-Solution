/**
 * components/SkipToContentLink.tsx
 * Visually hidden until focused — lets keyboard users jump past the navbar
 * straight to the page's main content (WCAG 2.1 SC 2.4.1 Bypass Blocks).
 */

export default function SkipToContentLink() {
  return (
    <a href="#main-content" className="skip-to-content-link">
      Skip to main content
    </a>
  );
}
