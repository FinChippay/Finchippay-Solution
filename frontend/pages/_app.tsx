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
import { NetworkProvider } from "@/lib/NetworkContext";
import OfflineBanner from "@/components/OfflineBanner";
import MobileBottomNav from "@/components/MobileBottomNav";
import OnboardingTour from "@/components/OnboardingTour";
import { useOnboardingTour } from "@/hooks/useOnboardingTour";
import { getStellarURIFromURL, registerProtocolHandler, type URIParseResult } from "@/lib/sep0007";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { getDirection, syncDocumentDirection } from "@/lib/useDirection";
import { initSdkAuth } from "@/lib/sdk-instance";
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
  useEffect(() => { const saved = localStorage.getItem("finchippay:theme") as "dark" | "light" | null; const preferred = saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); document.documentElement.classList.toggle("dark", preferred === "dark"); }, []);
  useEffect(() => { const uriResult = getStellarURIFromURL(); if (uriResult) setStellarURI(uriResult); }, []);
  useEffect(() => { registerProtocolHandler(); }, []);
  return (
    <I18nextProvider i18n={i18n}>
      <DirectionSync />
      <ThemeProvider><ToastProvider><WalletProvider><NetworkProvider>
        <Head><title>Finchippay-Solution | Instant Stellar Payments</title></Head>
        <AppShell Component={Component} pageProps={pageProps} stellarURI={stellarURI} isQuickSendOpen={isQuickSendOpen} setIsQuickSendOpen={setIsQuickSendOpen} />
        <ToastContainer />
      </WalletProvider></ToastProvider></ThemeProvider></NetworkProvider>
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
      <div className="min-h-screen bg-white bg-grid transition-colors duration-300 dark:bg-cosmos-900">
        <OfflineBanner /><Navbar onTakeTour={tour.startTour} /><OnboardingTour tour={tour} />
        <main className="pb-20 md:pb-0"><AnimatePresence mode="wait"><motion.div key={router.route} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}><Component {...pageProps} stellarURI={stellarURI} /></motion.div></AnimatePresence></main>
        <MobileBottomNav />
      </div>
      {publicKey && <QuickSendModal isOpen={isQuickSendOpen} onClose={() => setIsQuickSendOpen(false)} publicKey={publicKey} xlmBalance="0" usdcBalance={null} />}
    </MotionConfig>
  );
}
