export const packageName = "@platform/profile-configuration";

export type Theme = "light" | "dark" | "system";

export interface UserPreferences {
  theme: Theme;
  language: string;
  timezone: string;
  emailNotifications: boolean;
  marketingEmails: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<UserPreferences> = {
  theme: "system",
  language: "en-GB",
  timezone: "UTC",
  emailNotifications: true,
  marketingEmails: false,
};

export interface ProfileConfigPort {
  get(userId: string): Promise<UserPreferences>;
  update(userId: string, partial: Partial<UserPreferences>): Promise<UserPreferences>;
  reset(userId: string): Promise<UserPreferences>;
}

export function createInMemoryProfileConfigPort(): ProfileConfigPort {
  const store = new Map<string, UserPreferences>();
  return {
    async get(userId) {
      return store.get(userId) ?? { ...DEFAULT_PREFERENCES };
    },
    async update(userId, partial) {
      const current = store.get(userId) ?? { ...DEFAULT_PREFERENCES };
      const updated = { ...current, ...partial };
      store.set(userId, updated);
      return updated;
    },
    async reset(userId) {
      const defaults = { ...DEFAULT_PREFERENCES };
      store.set(userId, defaults);
      return defaults;
    },
  };
}
