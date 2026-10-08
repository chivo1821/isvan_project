import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
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
  title: "Gestión Logística",
  description: "Sistema de logística para venta y despacho de helados y pizzas congeladas",
  // La app ya está en español. Si Chrome la "traduce", mete sus propias
  // etiquetas en el DOM y React se rompe al actualizar (NotFoundError en
  // insertBefore/removeChild), p. ej. al tomar una foto en el censo.
  other: { google: "notranslate" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      translate="no"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Siempre en claro. Antes lo forzaba next-themes (forcedTheme="light"),
      // pero su <script> de arranque hace que React 19.2 avise en consola
      // ("Encountered a script tag"), y para un tema fijo no hace falta.
      // color-scheme mantiene en claro los controles nativos (fecha, scroll).
      style={{ colorScheme: "light" }}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
