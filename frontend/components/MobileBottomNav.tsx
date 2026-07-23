import Link from "next/link";
import { useRouter } from "next/router";
import { HomeIcon, PaperAirplaneIcon, ListBulletIcon, Cog8ToothIcon } from "@heroicons/react/24/outline";
import { HomeIcon as HomeIconSolid, PaperAirplaneIcon as PaperAirplaneIconSolid, ListBulletIcon as ListBulletIconSolid, Cog8ToothIcon as Cog8ToothIconSolid } from "@heroicons/react/24/solid";

export default function MobileBottomNav() {
  const router = useRouter();
  
  const navItems = [
    { name: "Home", href: "/", icon: HomeIcon, activeIcon: HomeIconSolid },
    { name: "Send", href: "/pay", icon: PaperAirplaneIcon, activeIcon: PaperAirplaneIconSolid },
    { name: "History", href: "/transactions", icon: ListBulletIcon, activeIcon: ListBulletIconSolid, badge: 2 }, // mocked badge
    { name: "Settings", href: "/settings", icon: Cog8ToothIcon, activeIcon: Cog8ToothIconSolid },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-slate-200 bg-white pb-safe pt-1 dark:border-cosmos-800 dark:bg-cosmos-900 md:hidden">
      {navItems.map((item) => {
        const isActive = router.pathname === item.href || (item.href !== "/" && router.pathname.startsWith(item.href));
        const Icon = isActive ? item.activeIcon : item.icon;

        return (
          <Link
            key={item.name}
            href={item.href}
            className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 p-2 transition-colors ${
              isActive
                ? "text-stellar-600 dark:text-stellar-400"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <div className="relative">
              <Icon className="h-6 w-6" />
              {item.badge && (
                <span className="absolute -right-2 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {item.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] font-medium leading-none">{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
