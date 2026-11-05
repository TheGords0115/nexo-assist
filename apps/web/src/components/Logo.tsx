// Logo "N" do Nexo Assist (o mesmo traço do protótipo).
export function LogoMark({ className = 'h-4 w-4', color = 'currentColor' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M3 21V3h4.2l9.6 12.4V3H21v18h-4.2L7.2 8.6V21H3z" fill={color} />
    </svg>
  )
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <LogoMark className="h-[18px] w-[18px]" color={dark ? '#ffffff' : '#0a63c9'} />
      <span className={`text-[15px] font-semibold ${dark ? 'text-white' : 'text-ink'}`}>Nexo Assist</span>
    </div>
  )
}
