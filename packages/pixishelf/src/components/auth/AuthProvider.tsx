'use client'

import React, { PropsWithChildren, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useRouter } from 'next/navigation'
import { ROUTES } from '@/lib/constants'
import { authClient } from '@/lib/auth/client'
import type { AuthMeResponseDTO } from '@/schemas/auth.dto'

export interface AuthUser {
  id: string
  name: string | null
  email: string | null
  image: string | null
}

interface AuthState {
  user: AuthUser | null
  hydrateUser: (user: AuthUser | null) => void
  setUser: (user: AuthUser | null) => void
}

interface AuthContextType {
  user: AuthUser | null
  logout: () => Promise<void>
  refreshUser: () => void
}

const normalizeUser = (
  user?: {
    id: string | number
    name?: string | null
    email?: string | null
    image?: string | null
  } | null
): AuthUser | null => {
  if (!user) return null

  return {
    id: String(user.id),
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null
  }
}

const useAuthStore = create<AuthState>((set) => ({
  user: null,
  hydrateUser: (user) => set({ user }),
  setUser: (user) => set({ user })
}))

function AuthSync({ children, initialUser }: PropsWithChildren<{ initialUser?: AuthUser | null }>) {
  const { data: session } = authClient.useSession()
  const initializedRef = useRef(false)
  const [initialSnapshot] = useState<AuthUser | null>(initialUser ?? null)
  const serializedInitialUser = JSON.stringify(initialUser ?? null)
  const lastHydratedUserRef = useRef<string>(serializedInitialUser)

  if (!initializedRef.current) {
    useAuthStore.setState({ user: initialSnapshot })
    initializedRef.current = true
    lastHydratedUserRef.current = serializedInitialUser
  }

  useEffect(() => {
    if (lastHydratedUserRef.current === serializedInitialUser) {
      return
    }

    lastHydratedUserRef.current = serializedInitialUser
    useAuthStore.getState().hydrateUser(initialUser ?? null)
  }, [initialUser, serializedInitialUser])

  useEffect(() => {
    const nextUser = session?.user
      ? normalizeUser({
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image
        })
      : initialUser ?? null

    useAuthStore.getState().setUser(nextUser)
  }, [session, initialUser])

  return <>{children}</>
}

export function AuthProvider({
  children,
  initialUser
}: PropsWithChildren<{
  initialUser?: AuthMeResponseDTO | null
}>) {
  const user = normalizeUser(initialUser ?? null)

  return <AuthSync initialUser={user}>{children}</AuthSync>
}

export const useAuth = (): AuthContextType => {
  const user = useAuthStore((state) => state.user)
  const router = useRouter()
  const logout = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          useAuthStore.getState().setUser(null)
          router.push(ROUTES.LOGIN)
        }
      }
    })
  }

  const refreshUser = () => {
    router.refresh()
  }

  return {
    user,
    logout,
    refreshUser
  }
}

export function useAuthUser() {
  return useAuthStore((state) => state.user)
}

export { useAuthStore }
