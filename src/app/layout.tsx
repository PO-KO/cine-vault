import React from 'react';
import type { Metadata } from 'next';
import '../index.css';

export const metadata: Metadata = {
  title: 'CineVault Local — Personal Media Streaming',
  description:
    'Personal local media streaming web application for browsing, organizing, and watching locally stored anime, TV shows, movies, and video files across PC, mobile, and Smart TV.',
  openGraph: {
    title: 'CineVault Local — Personal Media Streaming',
    description:
      'Personal local media streaming web application for browsing, organizing, and watching locally stored anime, TV shows, movies, and video files across PC, mobile, and Smart TV.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-rose-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
