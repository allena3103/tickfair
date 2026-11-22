/**
 * Who's online: traders connected to the floor right now (PresenceRoom,
 * with the ticker each is watching). Users with only a recent usePresence
 * heartbeat (up to ~5 minutes old) are listed separately as recently active
 * and are not counted as online.
 */

import { useMemo } from 'react'
import { useAuthProfileReady, usePresence } from 'deepspace'
import { Users, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFloorPresence, type FloorStatus } from '../shell/FloorPresence'
import { countOnFloor, mergeOnline, type OnlineTrader } from './onlineList'
import { FeedPanel, FeedEmpty, FeedError, FeedSkeleton } from './FeedPanel'

/** Live list of traders. Shared by OnlineTraders and the header count. */
export function useOnlineTraders(): { traders: OnlineTrader[]; onlineCount: number; status: FloorStatus } {
  const { user, isSignedIn } = useAuthProfileReady()
  const { users, isOnline } = usePresence()
  const { peers, status, myTicker } = useFloorPresence()
  const traders = useMemo(
    () =>
      mergeOnline({
        self: isSignedIn && user ? { userId: user.id, name: user.name || user.email || 'You' } : null,
        selfOnFloor: status === 'connected',
        selfTicker: myTicker,
        peers,
        heartbeat: users.filter((u) => isOnline(u.id)),
      }),
    [isSignedIn, user, status, myTicker, peers, users, isOnline],
  )
  return { traders, onlineCount: countOnFloor(traders), status }
}

export function OnlineTraders({ className }: { className?: string }) {
  const { traders, status } = useOnlineTraders()
  return <OnlineTradersView traders={traders} status={status} className={className} />
}

export function OnlineTradersView({
  traders,
  status,
  className,
}: {
  traders: OnlineTrader[]
  status: FloorStatus
  className?: string
}) {
  const onFloor = traders.filter((t) => t.onFloor || t.isSelf)
  const recent = traders.filter((t) => !t.onFloor && !t.isSelf)
  return (
    <FeedPanel
      testId="online-traders"
      title="On the floor"
      meta={status === 'connecting' ? undefined : `${countOnFloor(traders)} online`}
      className={className}
    >
      {status === 'connecting' ? (
        <FeedSkeleton rows={3} />
      ) : (
        <>
          {status === 'reconnecting' && (
            <FeedError icon={<WifiOff />} message="Lost the floor connection. Reconnecting." />
          )}
          {traders.length === 0 ? (
            <FeedEmpty
              icon={<Users />}
              title="Nobody's here yet"
              description={status === 'signed-out' ? 'Sign in to show up on the floor.' : undefined}
            />
          ) : (
            <>
              {onFloor.length > 0 && (
                <ul className="divide-y divide-border">
                  {onFloor.map((t) => (
                    <TraderRow key={t.userId} t={t} />
                  ))}
                </ul>
              )}
              {recent.length > 0 && (
                <>
                  <p
                    data-testid="recently-active-label"
                    className="border-y border-border px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    Recently active · not counted
                  </p>
                  <ul className="divide-y divide-border">
                    {recent.map((t) => (
                      <TraderRow key={t.userId} t={t} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {status === 'signed-out' && traders.length > 0 && (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Sign in to show up on the floor.
            </p>
          )}
        </>
      )}
    </FeedPanel>
  )
}

function TraderRow({ t }: { t: OnlineTrader }) {
  const label = t.onFloor ? (t.ticker ?? 'on floor') : t.isSelf ? 'offline' : 'away'
  return (
    <li
      data-testid="online-trader"
      data-user-id={t.userId}
      data-self={t.isSelf}
      data-on-floor={t.onFloor}
      className={cn('flex items-center gap-3 px-3 py-2 text-sm', t.isSelf && 'bg-accent', !t.onFloor && 'text-muted-foreground')}
    >
      <span
        aria-hidden
        className={cn('h-2 w-2 shrink-0 rounded-full', t.onFloor ? 'bg-up' : 'border border-muted-foreground')}
      />
      <span className="min-w-0 flex-1 truncate">
        {t.name}
        {t.isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
      </span>
      <span data-testid="online-trader-status" className="font-mono text-xs text-muted-foreground">
        {label}
      </span>
    </li>
  )
}
