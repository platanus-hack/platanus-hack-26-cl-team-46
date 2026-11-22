import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ClickyDock } from "@/clicky/ClickyDock";
import { AppFrame } from "@/components/app/AppSidebar";
import { ConfirmProvider } from "@/components/mayday/ConfirmDialog";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mayday",
  description: "El simulador de vuelo para responder a un hackeo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-bg-000 antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg-000 font-sans text-ink">
        {/* Diálogos Mayday (useConfirm) en vez de los pop-ups nativos del navegador. */}
        <ConfirmProvider>
          {/* Barra lateral de navegación en toda la app, salvo la landing. */}
          <AppFrame>{children}</AppFrame>
        </ConfirmProvider>
        {/* Hinty (antes Clicky): el profesor que ve la pantalla. Dónde aparece se define en src/clicky/config.ts */}
        <Suspense fallback={null}>
          <ClickyDock />
        </Suspense>
      </body>
    </html>
  );
}
