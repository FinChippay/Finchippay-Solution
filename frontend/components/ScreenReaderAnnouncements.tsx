/**
 * components/ScreenReaderAnnouncements.tsx
 * App-wide visually-hidden live regions that announce dynamic updates
 * (transaction confirmations, balance changes, errors, route changes) to
 * assistive technology. Mounted once in pages/_app.tsx. Emit a message from
 * anywhere via `announce()` in @/lib/announce.
 */

import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { subscribeToAnnouncements, type AnnouncePriority } from "@/lib/announce";

const CLEAR_AFTER_MS = 5000;

export default function ScreenReaderAnnouncements() {
  const [politeMessage, setPoliteMessage] = useState("");
  const [assertiveMessage, setAssertiveMessage] = useState("");
  const clearTimers = useRef<Record<AnnouncePriority, number | null>>({
    polite: null,
    assertive: null,
  });
  const router = useRouter();

  useEffect(() => {
    return subscribeToAnnouncements((message, priority) => {
      const setter = priority === "assertive" ? setAssertiveMessage : setPoliteMessage;

      // Re-announce identical consecutive messages by clearing first, since
      // aria-live only fires on text mutation.
      setter("");
      window.setTimeout(() => setter(message), 20);

      const existingTimer = clearTimers.current[priority];
      if (existingTimer) window.clearTimeout(existingTimer);
      clearTimers.current[priority] = window.setTimeout(() => setter(""), CLEAR_AFTER_MS);
    });
  }, []);

  // Announce client-side route changes for screen reader / keyboard users.
  useEffect(() => {
    const handleRouteChange = (url: string) => {
      const path = url.split("?")[0];
      const label = path === "/" ? "Home" : path.replace(/^\//, "").replace(/-/g, " ");
      setPoliteMessage(`Navigated to ${label}`);
    };

    router.events.on("routeChangeComplete", handleRouteChange);
    return () => router.events.off("routeChangeComplete", handleRouteChange);
  }, [router.events]);

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {politeMessage}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertiveMessage}
      </div>
    </>
  );
}
