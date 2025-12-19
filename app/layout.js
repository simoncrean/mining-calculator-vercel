import './globals.css'
import { JetBrains_Mono } from 'next/font/google'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

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
    <html lang="en" className={jetbrainsMono.variable}>
      <body>{children}</body>
    </html>
  )
}
