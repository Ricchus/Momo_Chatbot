import type { AnchorState, AvatarManifest, ClipAsset } from "./types";

const IDLE_NEUTRAL_PRIMARY_ASSET_ID = "idle_neutral_0";
const IDLE_NEUTRAL_VARIANT_TRIGGER_RATE = 0.05;

export class LoopScheduler {
  constructor(private manifest: AvatarManifest, private recentWindow = 2) {}

  pickNext(state: AnchorState, recentIds: string[]): ClipAsset {
    const pool = this.manifest.loops[state] ?? [];
    if (pool.length === 0) {
      throw new Error(`状态 ${state} 没有可用 loop gif`);
    }

    if (pool.length === 1) return pool[0];

    const idleNeutralAsset = this.pickIdleNeutralLoop(state, pool, recentIds);
    if (idleNeutralAsset) {
      return idleNeutralAsset;
    }

    const banned = new Set(recentIds.slice(-this.recentWindow));
    let candidates = pool.filter((asset) => !banned.has(asset.id));

    if (candidates.length === 0) {
      const lastPlayed = recentIds[recentIds.length - 1];
      candidates = pool.filter((asset) => asset.id !== lastPlayed);
    }

    if (candidates.length === 0) {
      candidates = pool;
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  recordPlayed(
    record: Partial<Record<AnchorState, string[]>>,
    state: AnchorState,
    assetId: string
  ) {
    const prev = record[state] ?? [];
    record[state] = [...prev, assetId].slice(-4);
  }

  private pickIdleNeutralLoop(state: AnchorState, pool: ClipAsset[], recentIds: string[]) {
    if (state !== "idle_neutral") {
      return null;
    }

    const primary = pool.find((asset) => asset.id === IDLE_NEUTRAL_PRIMARY_ASSET_ID);
    if (!primary) {
      return null;
    }

    const variants = pool.filter((asset) => asset.id !== primary.id);
    if (variants.length === 0) {
      return primary;
    }

    if (Math.random() >= IDLE_NEUTRAL_VARIANT_TRIGGER_RATE) {
      return primary;
    }

    const banned = new Set(recentIds.slice(-this.recentWindow));
    let candidates = variants.filter((asset) => !banned.has(asset.id));

    if (candidates.length === 0) {
      const lastPlayed = recentIds[recentIds.length - 1];
      candidates = variants.filter((asset) => asset.id !== lastPlayed);
    }

    if (candidates.length === 0) {
      candidates = variants;
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
