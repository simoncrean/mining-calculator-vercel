import './globals.css'

export const metadata = {
  title: 'Bitcoin Mining Profitability Calculator',
  description: 'Calculate fractional hashrate mining returns with live BTC price appreciation modeling',
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    title: 'Bitcoin Mining Profitability Calculator',
    description: 'Calculate fractional hashrate mining returns with live BTC price appreciation modeling',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
