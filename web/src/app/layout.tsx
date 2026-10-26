import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { DayTipHost, ToastProvider } from "@/components/kit";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Отпуска 2027 — Авистрейд",
  description: "Сбор пожеланий по отпускам, проверка по регламенту и ТК РБ, согласование",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AppHeader />
        <main className="flex-1 w-full max-w-[1280px] mx-auto px-6 pt-8 pb-16">{children}</main>
        <ToastProvider />
        <DayTipHost />
      </body>
    </html>
  );
}
