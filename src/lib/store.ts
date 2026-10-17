import { LocalStorage } from "@raycast/api";

const KEYS = {
  pinnedModels: "pinned-models",
  recentModels: "recent-models",
  recentDirs: "recent-dirs",
  attachedSkills: "attached-skills",
  lastSession: "last-session",
  defaultCombo: "default-combo",
  defaultAgent: "default-agent",
  permissionMode: "permission-mode",
  lastDirectory: "last-directory",
} as const;

async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await LocalStorage.getItem<string>(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function setJSON(key: string, value: unknown): Promise<void> {
  await LocalStorage.setItem(key, JSON.stringify(value));
}

/* ------------------------------- models --------------------------------- */

export type AttachedSkill = { id: string; name: string };

export const store = {
  pinnedModels: () => getJSON<string[]>(KEYS.pinnedModels, []),
  setPinnedModels: (v: string[]) => setJSON(KEYS.pinnedModels, v),

  recentModels: () => getJSON<string[]>(KEYS.recentModels, []),
  pushRecentModel: async (id: string) => {
    const list = await getJSON<string[]>(KEYS.recentModels, []);
    const next = [id, ...list.filter((x) => x !== id)].slice(0, 8);
    await setJSON(KEYS.recentModels, next);
    return next;
  },

  recentDirs: () => getJSON<string[]>(KEYS.recentDirs, []),
  pushRecentDir: async (dir: string) => {
    const list = await getJSON<string[]>(KEYS.recentDirs, []);
    const next = [dir, ...list.filter((x) => x !== dir)].slice(0, 6);
    await setJSON(KEYS.recentDirs, next);
    return next;
  },

  attachedSkills: () => getJSON<AttachedSkill[]>(KEYS.attachedSkills, []),
  setAttachedSkills: (v: AttachedSkill[]) => setJSON(KEYS.attachedSkills, v),
  toggleAttachedSkill: async (skill: AttachedSkill) => {
    const list = await getJSON<AttachedSkill[]>(KEYS.attachedSkills, []);
    const exists = list.some((s) => s.id === skill.id);
    const next = exists ? list.filter((s) => s.id !== skill.id) : [...list, skill];
    await setJSON(KEYS.attachedSkills, next);
    return next;
  },

  lastSessionID: () => LocalStorage.getItem<string>(KEYS.lastSession),
  setLastSessionID: (id: string) => LocalStorage.setItem(KEYS.lastSession, id),

  defaultCombo: () => LocalStorage.getItem<string>(KEYS.defaultCombo),
  setDefaultCombo: (id: string) => LocalStorage.setItem(KEYS.defaultCombo, id),

  defaultAgent: () => LocalStorage.getItem<string>(KEYS.defaultAgent),
  setDefaultAgent: (id: string) => LocalStorage.setItem(KEYS.defaultAgent, id),

  permissionMode: () => LocalStorage.getItem<string>(KEYS.permissionMode),
  setPermissionMode: (mode: string) => LocalStorage.setItem(KEYS.permissionMode, mode),

  lastDirectory: () => LocalStorage.getItem<string>(KEYS.lastDirectory),
  setLastDirectory: (dir: string) => LocalStorage.setItem(KEYS.lastDirectory, dir),
};
