'use client'

import React, { createContext, useContext, useMemo, PropsWithChildren } from 'react'
import { useRouter } from 'next/navigation'
import { ROUTES } from '@/lib/constants'
import { authClient } from '@/lib/auth/client'

interface AuthContextType {
  user: {
    id: string
    name: string | null
    email: string | null
    image: string | null
  } | null
  logout: () => Promise<void>
  refreshUser: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function AuthSync({ children, initialUser }: PropsWithChildren<{ initialUser?: AuthContextType['user'] }>) {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()

  const logout = async () => {
    await authClient.signOut()
    router.push(ROUTES.LOGIN)
  }

  const contextValue = useMemo(() => {
    const user = session?.user
      ? {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image ?? null
        }
      : initialUser
        ? {
            ...initialUser,
            id: String(initialUser.id),
            image: initialUser.image ?? null
          }
        : null

    return {
      user,
      logout,
      refreshUser: () => {}
    }
  }, [session, initialUser, logout])

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
}

export function AuthProvider({
  children,
  initialUser
}: PropsWithChildren<{
  initialUser?: {
    id: string | number
    name?: string | null
    email?: string | null
    username?: string | null
    image?: string | null
  } | null
}>) {
  // Convert initialUser to AuthContextType['user'] format if needed
  const user = initialUser
    ? {
        id: String(initialUser.id),
        name: initialUser.name ?? null,
        email: initialUser.email ?? null,
        image: initialUser.image ?? null
      }
    : null

  return <AuthSync initialUser={user}>{children}</AuthSync>
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return context
}
