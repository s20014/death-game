// localStorage を使ったセッション管理

export type Role = 'gm' | 'player' | 'log';

export type Session = {
  roomId: string;
  role: Role;
  playerId: string; // GM も player として登録される
};

const KEY = 'dg_session';

export function saveSession(session: Session): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
