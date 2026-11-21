import { AppHeader } from "@/components/layout/app-header";

/** Layout de las páginas autenticadas (con header). El simulacro tiene el suyo. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
