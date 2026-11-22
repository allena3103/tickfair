/**
 * App header: wordmark, nav (src/nav.ts), round status, online count, and
 * the user menu. Keeps the scaffold test ids `app-navigation`,
 * `nav-sign-in-button`, `nav-user-name`, and `nav-user-email`.
 */

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthOverlay, useAuthProfileReady, signOut } from 'deepspace'
import { ChevronDown, LogOut, Menu, Users, X } from 'lucide-react'
import { APP_NAME, type Role } from '@/constants'
import { nav } from '@/nav'
import { cn } from '@/lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui'
import { useOnlineTraders } from '../feed/OnlineTraders'
import { RoundStatus } from './RoundStatus'

export function AppHeader() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const profileReady = !isSignedIn || (!userLoading && !!user)
  const userRole = (user?.role ?? 'anonymous') as Role | 'anonymous'

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const visibleNav = nav.filter((item) => {
    if (item.devOnly && !import.meta.env.DEV) return false
    if (!item.roles) return true
    if (!profileReady) return false
    if (userRole === 'admin') return true
    return item.roles.includes(userRole as Role)
  })

  const navLink = (item: (typeof nav)[number]) => {
    const active = location.pathname.startsWith(item.path)
    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative px-3 py-1.5 text-sm',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {item.label}
        {active && <span aria-hidden className="absolute inset-x-3 -bottom-[9px] h-0.5 bg-primary" />}
      </Link>
    )
  }

  return (
    <>
      <nav data-testid="app-navigation" className="shrink-0 border-b border-border bg-shell">
        <div className="flex h-12 items-center gap-3 px-4">
          <Link to="/home" className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-foreground">
            {APP_NAME}
          </Link>

          <div className="hidden items-center md:flex">{visibleNav.map(navLink)}</div>

          <div className="flex-1" />

          <RoundStatus className="hidden sm:inline-flex" />
          <OnlineCount />

          {!isLoaded ? null : isSignedIn && !profileReady ? (
            <div className="flex items-center gap-2 rounded-md border border-border py-1 pl-1 pr-2.5">
              <div className="h-6 w-6 animate-pulse rounded-full bg-muted" />
              <div className="hidden h-4 w-20 animate-pulse rounded-md bg-muted sm:block" />
            </div>
          ) : isSignedIn && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    aria-label="Account menu"
                    className="group flex items-center gap-2 rounded-md border border-border py-1 pl-1 pr-2.5 text-sm transition-colors hover:bg-accent"
                  >
                    <Avatar className="h-6 w-6 ring-1 ring-inset ring-border">
                      <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                      <AvatarFallback className="text-[11px]">
                        {(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span data-testid="nav-user-name" className="hidden max-w-[140px] truncate text-foreground sm:inline">
                      {user.name || user.email}
                    </span>
                    <ChevronDown
                      className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180"
                      aria-hidden
                    />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="truncate font-medium text-foreground">{user.name || 'Signed in'}</div>
                  <div data-testid="nav-user-email" className="truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              data-testid="nav-sign-in-button"
              onClick={() => setShowAuthModal(true)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Sign in
            </button>
          )}

          <button
            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="flex flex-col gap-2 border-t border-border px-2 py-2 md:hidden">
            {visibleNav.map(navLink)}
            <RoundStatus className="mx-3 self-start sm:hidden" />
          </div>
        )}
      </nav>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </>
  )
}

function OnlineCount() {
  const { traders, status } = useOnlineTraders()
  const count = traders.length
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-testid="online-count"
            tabIndex={0}
            className="inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 font-mono text-xs text-muted-foreground"
          >
            <Users className="h-3.5 w-3.5" aria-hidden />
            <span className="tabular-nums text-foreground">{status === 'connecting' ? '–' : count}</span>
            <span className="sr-only">online</span>
          </span>
        }
      />
      <TooltipContent>{count === 1 ? '1 trader online' : `${count} traders online`}</TooltipContent>
    </Tooltip>
  )
}
