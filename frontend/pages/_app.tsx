import "@/lib/api";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import type { AppProps } from "next/app";
import Head from "next/head";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import InstallPrompt from "@/components/InstallPrompt";
import MobileBottomNav from "@/components/MobileBottomNav";
import Navbar from "@/components/Navbar";
import OfflineBanner from "@/components/OfflineBanner";
import OnboardingTour from "@/components/OnboardingTour";
import QueueSyncNotifier from "@/components/QueueSyncNotifier";
import QuickSendModal from "@/components/QuickSendModal";
import ScreenReaderAnnouncements from "@/components/ScreenReaderAnnouncements";
import SkipToContentLink from "@/components/SkipToContentLink";
import { ToastContainer } from "@/components/Toast";
import { useOnboardingTour } from "@/hooks/useOnboardingTour";
import { FeatureFlagProvider } from "@/lib/FeatureFlags";
import { ThemeProvider } from "@/lib/ThemeContext";
import { ToastProvider } from "@/lib/ToastContext";
import i18n from "@/lib/i18n";
import { initSdkAuth } from "@/lib/sdk-instance";
import { getStellarURIFromURL, registerProtocolHandler, type URIParseResult } from "@/lib/sep0007";
import { getDirection, syncDocumentDirection } from "@/lib/useDirection";
import { WalletProvider, useWallet } from "@/lib/useWallet";
import "@/styles/globals.css";
import "@/styles/rtl.css";

function DirectionSync() {
  const [locale, setLocale] = useState(i18n.resolvedLanguage || i18n.language || "en");
  useEffect(() => {
    const syncDirection = (nextLocale: string) => { syncDocumentDirection(nextLocale); setLocale(nextLocale); };
    syncDirection(i18n.resolvedLanguage || i18n.language || "en");
    i18n.on("languageChanged", syncDirection);
    return () => i18n.off("languageChanged", syncDirection);
  }, []);
  return <span className="sr-only" data-locale={locale} data-direction={getDirection(locale)} />;
}

export default function App({ Component, pageProps }: AppProps) {
  const [stellarURI, setStellarURI] = useState<URIParseResult | null>(null);
  const [isQuickSendOpen, setIsQuickSendOpen] = useState(false);
  useEffect(() => { initSdkAuth(); }, []);
  useEffect(() => { if ("serviceWorker" in navigator) { void navigator.serviceWorker.register("/sw.js").catch(() => {}); } }, []);
  useEffect(() => { try { const raw = localStorage.getItem("finchippay:theme"); if (raw) { const parsed = JSON.parse(raw); if (parsed.mode === "dark" || (parsed.mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) { document.documentElement.classList.add("dark"); } else if (parsed.mode === "light") { document.documentElement.classList.remove("dark"); } if (parsed.accent) document.documentElement.dataset.accent = parsed.accent; if (parsed.fontSize) document.documentElement.dataset.fontSize = parsed.fontSize; } } catch {} }, []);
  useEffect(() => { const uriResult = getStellarURIFromURL(); if (uriResult) setStellarURI(uriResult); }, []);
  useEffect(() => { registerProtocolHandler(); }, []);
  return (
    <I18nextProvider i18n={i18n}>
      <DirectionSync />
      <ThemeProvider><ToastProvider><WalletProvider>
        <Head><title>Finchippay-Solution | Instant Stellar Payments</title></Head>
        <AppShell Component={Component} pageProps={pageProps} stellarURI={stellarURI} isQuickSendOpen={isQuickSendOpen} setIsQuickSendOpen={setIsQuickSendOpen} />
        <InstallPrompt />
        <QueueSyncNotifier />
        <ToastContainer />
      </WalletProvider></ToastProvider></ThemeProvider>
    </I18nextProvider>
  );
}

function AppShell({ Component, pageProps, stellarURI, isQuickSendOpen, setIsQuickSendOpen }: { Component: AppProps["Component"]; pageProps: AppProps["pageProps"]; stellarURI: URIParseResult | null; isQuickSendOpen: boolean; setIsQuickSendOpen: (v: boolean) => void }) {
  const { publicKey } = useWallet();
  return (<FeatureFlagProvider publicKey={publicKey}><AppShellInner Component={Component} pageProps={pageProps} stellarURI={stellarURI} isQuickSendOpen={isQuickSendOpen} setIsQuickSendOpen={setIsQuickSendOpen} /></FeatureFlagProvider>);
}

function AppShellInner({ Component, pageProps, stellarURI, isQuickSendOpen, setIsQuickSendOpen }: { Component: AppProps["Component"]; pageProps: AppProps["pageProps"]; stellarURI: URIParseResult | null; isQuickSendOpen: boolean; setIsQuickSendOpen: (v: boolean) => void }) {
  const { publicKey } = useWallet();
  const router = useRouter();
  const tour = useOnboardingTour();
  return (
    <MotionConfig reducedMotion="user">
      <SkipToContentLink />
      <ScreenReaderAnnouncements />
      <div className="min-h-screen bg-[var(--color-bg-primary)] bg-grid transition-colors duration-300">
        <OfflineBanner /><Navbar onTakeTour={tour.startTour} /><OnboardingTour tour={tour} />
        <main id="main-content" tabIndex={-1} className="pb-20 md:pb-0 focus:outline-none"><AnimatePresence mode="wait"><motion.div key={router.route} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}><Component {...pageProps} stellarURI={stellarURI} /></motion.div></AnimatePresence></main>
        <MobileBottomNav />
      </div>
      {publicKey && <QuickSendModal isOpen={isQuickSendOpen} onClose={() => setIsQuickSendOpen(false)} publicKey={publicKey} xlmBalance="0" usdcBalance={null} />}
    </MotionConfig>
  );
}
