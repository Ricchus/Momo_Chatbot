import { getSemanticMidCandidates } from "./avatarConfig";
import type { AnchorState, AvatarManifest, RoutePlan, TransitionLeg } from "./types";

export class RoutePlanner {
  constructor(private manifest: AvatarManifest) {}

  private resolveLeg(from: AnchorState, to: AnchorState): TransitionLeg | null {
    if (from === to) return null;

    const direct = this.manifest.transitions[`tr_${from}_to_${to}`];
    if (direct) {
      return { from, to, asset: direct, direction: "forward" };
    }

    const reverseBase = this.manifest.transitions[`tr_${to}_to_${from}`];
    if (reverseBase?.reverseSrc) {
      return { from, to, asset: reverseBase, direction: "reverse" };
    }

    return null;
  }

  private planVia(from: AnchorState, mid: AnchorState, to: AnchorState): RoutePlan | null {
    if (mid === from || mid === to) return null;
    const first = this.resolveLeg(from, mid);
    const second = this.resolveLeg(mid, to);
    if (first && second) {
      return {
        kind: "transition_plan",
        legs: [first, second]
      };
    }
    return null;
  }

  private searchBestPath(from: AnchorState, to: AnchorState): RoutePlan | null {
    const queue: Array<{ state: AnchorState; legs: TransitionLeg[] }> = [{ state: from, legs: [] }];
    const visited = new Set<AnchorState>([from]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;

      const allStates = Object.keys(this.manifest.loops) as AnchorState[];
      for (const next of allStates) {
        if (visited.has(next) || next === current.state) continue;
        const leg = this.resolveLeg(current.state, next);
        if (!leg) continue;
        const nextLegs = [...current.legs, leg];

        if (next === to) {
          return { kind: "transition_plan", legs: nextLegs };
        }

        visited.add(next);
        if (nextLegs.length < 3) {
          queue.push({ state: next, legs: nextLegs });
        }
      }
    }

    return null;
  }

  plan(from: AnchorState, to: AnchorState): RoutePlan {
    if (from === to) return { kind: "same_state" };

    const direct = this.resolveLeg(from, to);
    if (direct) return { kind: "transition_plan", legs: [direct] };

    const viaIdle = this.planVia(from, "idle_neutral", to);
    if (viaIdle) return viaIdle;

    for (const mid of getSemanticMidCandidates(to)) {
      const viaMid = this.planVia(from, mid, to);
      if (viaMid) return viaMid;
    }

    const searched = this.searchBestPath(from, to);
    if (searched) return searched;

    return { kind: "direct_switch", target: to };
  }
}
