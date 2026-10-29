const BASE = 'krypteditor://models/';

export const modelCache = {
  async match(key: string): Promise<Response | undefined> {
    try {
      const res = await fetch(BASE + encodeURIComponent(key));
      return res.ok ? res : undefined;
    } catch {
      return undefined;
    }
  },
  async put(key: string, response: Response): Promise<void> {
    try {
      await fetch(BASE + encodeURIComponent(key), { method: 'PUT', body: await response.blob() });
    } catch {
    }
  },
};
