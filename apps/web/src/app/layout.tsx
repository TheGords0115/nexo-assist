import type { Metadata } from 'next'
import { Inter, Source_Serif_4 } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--font-serif-display' })

export const metadata: Metadata = {
  title: 'Nexo Assist · Service desk de TI',
  description: 'Atendimento de TI da Nexo em uma conversa.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  )
}
