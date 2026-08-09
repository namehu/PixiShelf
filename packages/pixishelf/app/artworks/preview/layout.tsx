import React from 'react'

interface RootLayoutProps {
  children: React.ReactNode
}

export default function RootLayout(props: RootLayoutProps) {
  return <main className="min-h-screen bg-black">{props.children}</main>
}
