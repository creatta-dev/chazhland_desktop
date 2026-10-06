import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Avatar } from '@/components/Avatar'
import { RankChip } from '@/components/RankChip'
import { Skeleton } from '@/components/Skeleton'
import { api } from '@/lib/api'
import { friends } from '@/lib/friends'
import type { AchievementShowcaseItem, Member, MemberRank } from '@/lib/types'
import { FriendshipActions } from './FriendshipActions'

// системный пользователь «Система» (бэк: User.SYSTEM_ID) — в друзья его не добавить
const SYSTEM_USER_ID = 'SYSTEM00000000000000000000'

// Профиль участника: аватар, ник, ранг и ВИТРИНА АЧИВОК (api.userAchievements — все открытые или только
// закреплённые, по настройке владельца). Открывается кликом по аватару в списке участников.
export function ProfileModal({ member, rank, self, onClose, onOpenDm }: {
  member: Member
  rank?: MemberRank
  self?: boolean
  onClose: () => void
  onOpenDm?: (userId: string) => void
}) {
  const [ach, setAch] = useState<AchievementShowcaseItem[] | null>(null)
  const [, setTick] = useState(0)
  useEffect(() => friends.subscribe(() => setTick((t) => t + 1)), [])
  const isFriend = friends.isFriend(member.userId)
  useEffect(() => {
    let a = true
    api.userAchievements(member.userId).then((r) => { if (a) setAch(r) }).catch(() => { if (a) setAch([]) })
    return () => { a = false }
  }, [member.userId])

  return (
    <Modal title="Профиль" onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar name={member.username} src={member.avatarUrl} size={64} frame={rank?.equipped?.frame} glow={rank?.equipped?.glow} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 19, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.username}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
            {rank && <RankChip level={rank.level} title={rank.title} compact />}
            {member.role === 'OWNER' && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>👑 Владелец</span>}
          </div>
          {member.statusMessage?.trim() && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 7 }}>{member.statusMessage.trim()}</div>}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '.05em', marginBottom: 10 }}>🎖️ ВИТРИНА АЧИВОК</div>
        {ach === null && <div style={{ display: 'flex', gap: 8 }}>{[0, 1, 2].map((i) => <Skeleton key={i} w={92} h={34} r={10} />)}</div>}
        {ach && ach.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Пока нет ачивок на витрине.</div>}
        {ach && ach.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ach.map((a) => (
              <div key={a.id} title={a.name} style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--border)', borderRadius: 10, padding: '6px 11px', background: 'var(--surface)', fontSize: 13, fontWeight: 600 }}>
                <span style={{ fontSize: 16 }}>{a.emoji}</span>{a.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {!self && (
        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* ЛС — только друзьям: «Написать» есть лишь у друга, остальным — кнопки дружбы */}
          {onOpenDm && isFriend && (
            <button onClick={() => { onOpenDm(member.userId); onClose() }} className="accent-btn no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 12, padding: '11px 18px', fontWeight: 700, fontSize: 14 }}>
              <MessageSquare size={16} /> Написать
            </button>
          )}
          {member.userId !== SYSTEM_USER_ID && <FriendshipActions userId={member.userId} username={member.username} />}
        </div>
      )}
    </Modal>
  )
}
