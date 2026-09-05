/**
 * Reconcile a temporary local assistant message with the persisted server row.
 * Identity is generationId / localId — never content text alone.
 */
export function reconcileAssistantMessage<
  T extends { id: string; metadata?: Record<string, unknown> },
>(options: {
  previous: T[];
  localAssistantId: string;
  generationId: string;
  serverMessage: T;
}): T[] {
  const { previous, localAssistantId, generationId, serverMessage } = options;
  const withMeta: T = {
    ...serverMessage,
    metadata: {
      ...(serverMessage.metadata ?? {}),
      generationId,
    },
  };

  const matchesGeneration = (m: T) =>
    m.id === localAssistantId ||
    m.metadata?.generationId === generationId ||
    m.id === serverMessage.id;

  const idx = previous.findIndex(matchesGeneration);
  if (idx >= 0) {
    const next = previous.map((m, i) => (i === idx ? withMeta : m));
    // Drop any extra copies tied to this generation or server id
    return next.filter((m, i) => {
      if (i === idx) return true;
      if (m.id === serverMessage.id) return false;
      if (m.id === localAssistantId) return false;
      if (m.metadata?.generationId === generationId) return false;
      return true;
    });
  }

  if (previous.some((m) => m.id === serverMessage.id)) {
    return previous;
  }
  return [...previous, withMeta];
}
