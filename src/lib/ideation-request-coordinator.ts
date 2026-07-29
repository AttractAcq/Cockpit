// Stage 2 scoring mutations join the same client-owned coordinator, so a client
// change invalidates in-flight scoring exactly as it does generation.
export type IdeationMutationKind =
  | "generate"
  | "retry"
  | "score"
  | "retry-score"
  | "rescore"
  // Stage 3 proposal mutations. Each is a distinct kind so a duplicate click on
  // one action cannot block an unrelated one, while a client change still
  // invalidates every in-flight proposal token at once.
  | "propose"
  | "retry-proposal"
  | "regenerate-proposal"
  | "edit-proposal"
  | "refresh-conflicts"
  | "approve-proposal";

export interface IdeationMutationToken {
  readonly clientId: string;
  readonly generation: number;
  readonly kind: IdeationMutationKind;
}

export interface IdeationRequestCoordinator {
  synchronizeClient(clientId: string): void;
  begin(kind: IdeationMutationKind, clientId: string): IdeationMutationToken | null;
  isCurrent(token: IdeationMutationToken): boolean;
  finish(token: IdeationMutationToken): void;
  dispose(): void;
}

export function createIdeationRequestCoordinator(initialClientId: string): IdeationRequestCoordinator {
  let currentClientId = initialClientId;
  let generation = 1;
  let mounted = true;
  const active = new Set<IdeationMutationKind>();

  return {
    synchronizeClient(clientId) {
      if (!mounted) mounted = true;
      if (clientId === currentClientId) return;
      currentClientId = clientId;
      generation += 1;
      active.clear();
    },
    begin(kind, clientId) {
      if (!mounted || clientId !== currentClientId || active.has(kind)) return null;
      active.add(kind);
      return { clientId, generation, kind };
    },
    isCurrent(token) {
      return mounted
        && token.clientId === currentClientId
        && token.generation === generation
        && active.has(token.kind);
    },
    finish(token) {
      if (this.isCurrent(token)) active.delete(token.kind);
    },
    dispose() {
      mounted = false;
      generation += 1;
      active.clear();
    },
  };
}
