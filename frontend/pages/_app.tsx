/**
 * pages/_app.tsx
 * Global app wrapper for theme, wallet, navigation, and shared overlays.
 */

import "@/lib/api";
import type { AppProps } from "next/app";
import { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import Navbar from "@/components/Navbar";
import QuickSendModal from "@/components/QuickSendModal";
import { ToastContainer } from "@/components/Toast";
import { ToastProvider } from "@/lib/ToastContext";
import { WalletProvider, useWallet } from "@/lib/useWallet";
import { FeatureFlagProvider } from "@/lib/FeatureFlags";
import { ThemeProvider } from "@/lib/ThemeContext";
import OfflineBanner from "@/components/OfflineBanner";
import InstallPrompt from "@/components/InstallPrompt";
import MobileBottomNav from "@/components/MobileBottomNav";
import OnboardingTour from "@/components/OnboardingTour";
import { useOnboardingTour } from "@/hooks/useOnboardingTour";
import {
  getStellarURIFromURL,
  registerProtocolHandler,
  type URIParseResult,
} from "@/lib/sep0007";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { getDirection, syncDocumentDirection } from "@/lib/useDirection";
import { initSdkAuth } from "@/lib/sdk-instance";
import "@/styles/globals.css";

function DirectionSync() {
  const [locale, setLocale] = useState(i18n.resolvedLanguage || i18n.language || "en");

  useEffect(() => {
    const syncDirection = (nextLocale: string) => {
      syncDocumentDirection(nextLocale);
      setLocale(nextLocale);
    };

    syncDirection(i18n.resolvedLanguage || i18n.language || "en");
    i18n.on("languageChanged", syncDirection);
    return () => i18n.off("languageChanged", syncDirection);
  }, []);

  // Keeping this node in the tree lets React update immediately after a locale
  // switch while the document attributes are synchronised imperatively above.
  return <span className="sr-only" data-locale={locale} data-direction={getDirection(locale)} />;
}

function AppShell({
  Component,
  pageProps,
  stellarURI,
  isQuickSendOpen,
  setIsQuickSendOpen,
}: {
  Component: AppProps["Component"];
  pageProps: AppProps["pageProps"];
  stellarURI: URIParseResult | null;
  isQuickSendOpen: boolean;
  setIsQuickSendOpen: (isOpen: boolean) => void;
}) {
  const { publicKey } = useWallet();

  return (
    <FeatureFlagProvider publicKey={publicKey}>
      <AppShellInner
        Component={Component}
        pageProps={pageProps}
        stellarURI={stellarURI}
        isQuickSendOpen={isQuickSendOpen}
        setIsQuickSendOpen={setIsQuickSendOpen}
      />
    </FeatureFlagProvider>
  );
}

function AppShellInner({
  Component,
  pageProps,
  stellarURI,
  isQuickSendOpen,
  setIsQuickSendOpen,
}: {
  Component: AppProps["Component"];
  pageProps: AppProps["pageProps"];
  stellarURI: URIParseResult | null;
  isQuickSendOpen: boolean;
  setIsQuickSendOpen: (isOpen: boolean) => void;
}) {
  const { publicKey } = useWallet();
  const router = useRouter();

  // ── Onboarding tour ───────────────────────────────────────────────────────
  // The hook owns all tour state; we pass `startTour` to Navbar so the
  // "Take a Tour" button can launch it from anywhere in the app.
  const tour = useOnboardingTour();

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-white bg-grid transition-colors duration-300 dark:bg-cosmos-900">
        <OfflineBanner />
        <Navbar onTakeTour={tour.startTour} />
        {/* OnboardingTour is rendered here so it overlays the entire page */}
        <OnboardingTour tour={tour} />
        <main className="pb-20 md:pb-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={router.route}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Component {...pageProps} stellarURI={stellarURI} />
            </motion.div>
          </AnimatePresence>
        </main>
        <InstallPrompt />
        <MobileBottomNav />
      </div>

      {publicKey && (
        <QuickSendModal
          isOpen={isQuickSendOpen}
          onClose={() => setIsQuickSendOpen(false)}
          publicKey={publicKey}
          xlmBalance="0"
          usdcBalance={null}
        />
      )}
    </MotionConfig>
  );
}

export default function App({ Component, pageProps }: AppProps) {
  const [stellarURI, setStellarURI] = useState<URIParseResult | null>(null);
  const [isQuickSendOpen, setIsQuickSendOpen] = useState(false);

  useEffect(() => {
    // Initialize SDK auth from stored token
    initSdkAuth();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("finchippay:theme") as
      | "dark"
      | "light"
      | null;
    const preferred =
      saved ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    document.documentElement.classList.toggle("dark", preferred === "dark");
  }, []);

  useEffect(() => {
    const uriResult = getStellarURIFromURL();
    if (uriResult) {
      setStellarURI(uriResult);
    }
  }, []);

  useEffect(() => {
    registerProtocolHandler();
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const registerWorker = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.warn("[PWA] Service worker registration failed:", error);
      });
    };

    if (document.readyState === "complete") {
      registerWorker();
      return;
    }

    window.addEventListener("load", registerWorker, { once: true });
    return () => window.removeEventListener("load", registerWorker);
  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      <DirectionSync />
      <ThemeProvider>
      <ToastProvider>
      <WalletProvider>
        <Head>
          <title>Finchippay-Solution | Instant Stellar Payments</title>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
          <meta
            name="description"
            content="Send instant, low-fee payments globally using the Stellar network — streaming, escrow, multi-sig, and tips. Non-custodial, secure, and transparent."
          />
          <link rel="canonical" href="https://finchippay.vercel.app/" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <meta property="og:type" content="website" />
          <meta property="og:url" content="https://finchippay.vercel.app/" />
          <meta
            property="og:title"
            content="Finchippay-Solution | Instant Stellar Payments"
          />
          <meta
            property="og:description"
            content="Send instant, low-fee payments globally using the Stellar network — streaming, escrow, multi-sig, and tips. Non-custodial, secure, and transparent."
          />
          <meta
            property="og:image"
            content="https://finchippay.vercel.app/og-card.png"
          />
          <meta name="twitter:card" content="summary_large_image" />
          <meta
            name="twitter:title"
            content="Finchippay-Solution | Instant Stellar Payments"
          />
          <meta
            name="twitter:description"
            content="Send instant, low-fee payments globally using the Stellar network — streaming, escrow, multi-sig, and tips. Non-custodial, secure, and transparent."
          />
          <meta
            name="twitter:image"
            content="https://finchippay.vercel.app/og-card.png"
          />
        </Head>

        <AppShell
          Component={Component}
          pageProps={pageProps}
          stellarURI={stellarURI}
          isQuickSendOpen={isQuickSendOpen}
          setIsQuickSendOpen={setIsQuickSendOpen}
        />
        <ToastContainer />
      </WalletProvider>
      </ToastProvider>
    </ThemeProvider>
    </I18nextProvider>
  );
}
