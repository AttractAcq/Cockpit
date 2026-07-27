export type IdeationMutationKind = "generate" | "retry";

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
