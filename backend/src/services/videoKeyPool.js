/**
 * videoKeyPool — SOVEREIGN STEALTH CAROUSEL v1.2.0
 * Unified identity and key management for YouTube extraction.
 */

class VideoKeyPool {
  constructor() {
    this.geminiKeys = [];
    this.groqKeys = [];
    this.allKeys = [];
    this.keyHealth = new Map(); // Key -> { failures, lastUsed, isExhausted, type }
    this.identities = [
      { name: 'ANDROID_STABLE', ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)', clientName: '3' },
      { name: 'TV_STABLE', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', clientName: '16' }
    ];
    this.loadKeys();
  }

  loadKeys() {
    // 1. Load Gemini Keys
    const gKeys = process.env.GEMINI_API_KEYS;
    if (gKeys) {
      this.geminiKeys = gKeys.split(/[,;]/).map(k => k.trim()).filter(k => k.length > 0);
    }

    // 2. Load Groq Keys (Borrowing for InnerTube bypass)
    const grKey = process.env.VITE_GROQ_API_KEY;
    if (grKey) {
      this.groqKeys = [grKey];
    }

    this.allKeys = [...this.geminiKeys, ...this.groqKeys].map(key => ({
      key,
      type: this.geminiKeys.includes(key) ? 'gemini' : 'groq'
    }));

    console.log(`[VideoStealth] Carousel initialized with ${this.allKeys.length} identifiers.`);

    for (const item of this.allKeys) {
      this.keyHealth.set(item.key, { failures: 0, lastUsed: 0, isExhausted: false, type: item.type });
    }
  }

  /**
   * Returns a healthy key and a persistent identity for the session.
   */
  getStealthBundle() {
    const healthy = this.allKeys.filter(item => !this.keyHealth.get(item.key).isExhausted);
    
    if (healthy.length === 0) {
      // Emergency recovery: revive oldest exhausted key if > 10 mins
      const now = Date.now();
      let oldest = null;
      for (const [key, stats] of this.keyHealth.entries()) {
        if (!oldest || stats.lastUsed < oldest.lastUsed) {
          oldest = { key, ...stats };
        }
      }
      if (oldest && now - oldest.lastUsed > 600000) {
         console.log(`[VideoStealth] Attempting recovery for identifier: ${oldest.key.substring(0, 8)}`);
         this.keyHealth.get(oldest.key).isExhausted = false;
         return { key: oldest.key, identity: this.identities[0] };
      }
      throw new Error('VIDEO_FARM_EXHAUSTED');
    }

    // Weighted random selection to mitigate bot patterns
    const selection = healthy[Math.floor(Math.random() * healthy.length)];
    const identity = this.identities[Math.floor(Math.random() * this.identities.length)];
    
    this.keyHealth.get(selection.key).lastUsed = Date.now();
    return { key: selection.key, identity };
  }

  reportFailure(key, error) {
    const stats = this.keyHealth.get(key);
    if (!stats) return;
    stats.failures++;
    if (error?.includes('429') || error?.includes('quota')) {
      stats.isExhausted = true;
      console.warn(`[VideoStealth] Identifier exhausted: ${key.substring(0, 8)}`);
    }
  }
}

export const videoKeyPool = new VideoKeyPool();
export default videoKeyPool;
