/**
 * Who's online: floor presence (live, with the ticker each trader is
 * watching) merged with usePresence heartbeats (recently active).
 */

import { useMemo } from 'react'
import { useAuthProfileReady, usePresence } from 'deepspace'
import { Users, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFloorPresence, type FloorStatus } from '../shell/FloorPresence'
import { mergeOnline, type OnlineTrader } from './onlineList'
import { FeedPanel, FeedEmpty, FeedError, FeedSkeleton } from './FeedPanel'

/** Live list of online traders. Shared by OnlineTraders and the header count. */
export function useOnlineTraders(): { traders: OnlineTrader[]; status: FloorStatus } {
  const { user, isSignedIn } = useAuthProfileReady()
  const { users, isOnline } = usePresence()
  const { peers, status } = useFloorPresence()
  const traders = useMemo(
    () =>
      mergeOnline({
        self: isSignedIn && user ? { userId: user.id, name: user.name || user.email || 'You' } : null,
        selfOnFloor: status === 'connected',
        peers,
        heartbeat: users.filter((u) => isOnline(u.id)),
      }),
    [isSignedIn, user, status, peers, users, isOnline],
  )
  return { traders, status }
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
  return (
    <FeedPanel
      testId="online-traders"
      title="On the floor"
      meta={status === 'connecting' ? undefined : `${traders.length} online`}
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
            <ul className="divide-y divide-border">
              {traders.map((t) => (
                <li
                  key={t.userId}
                  data-testid="online-trader"
                  data-user-id={t.userId}
                  data-self={t.isSelf}
                  data-on-floor={t.onFloor}
                  className={cn('flex items-center gap-3 px-3 py-2 text-sm', t.isSelf && 'bg-accent')}
                >
                  <span
                    aria-hidden
                    className={cn('h-2 w-2 shrink-0 rounded-full', t.onFloor ? 'bg-up' : 'border border-muted-foreground')}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {t.name}
                    {t.isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {t.ticker ?? (t.onFloor ? 'on floor' : 'idle')}
                  </span>
                </li>
              ))}
            </ul>
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
