import { redirect } from 'next/navigation'
import { ROUTES } from '@/lib/constants'

export default function SettingsIndexPage() {
  redirect(ROUTES.SETTINGS_PROFILE)
}
