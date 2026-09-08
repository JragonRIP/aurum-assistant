/**
 * Playlist ownership / writability — do not assume library visibility means writable.
 */

export type PlaylistWriteAssessment = {
  ownerId: string | null;
  currentUserId: string | null;
  collaborative: boolean;
  ownerMatchesUser: boolean | null;
  writable: boolean;
  reason: "owned" | "collaborative" | "not_writable" | "unknown_owner";
};

export function assessPlaylistWritability(opts: {
  ownerId?: string | null;
  currentUserId?: string | null;
  collaborative?: boolean | null;
}): PlaylistWriteAssessment {
  const ownerId = opts.ownerId?.trim() || null;
  const currentUserId = opts.currentUserId?.trim() || null;
  const collaborative = Boolean(opts.collaborative);
  const ownerMatchesUser =
    ownerId && currentUserId ? ownerId === currentUserId : null;

  if (ownerMatchesUser === true) {
    return {
      ownerId,
      currentUserId,
      collaborative,
      ownerMatchesUser,
      writable: true,
      reason: "owned",
    };
  }
  if (collaborative) {
    return {
      ownerId,
      currentUserId,
      collaborative,
      ownerMatchesUser,
      writable: true,
      reason: "collaborative",
    };
  }
  if (ownerMatchesUser === false) {
    return {
      ownerId,
      currentUserId,
      collaborative,
      ownerMatchesUser,
      writable: false,
      reason: "not_writable",
    };
  }
  return {
    ownerId,
    currentUserId,
    collaborative,
    ownerMatchesUser,
    writable: false,
    reason: "unknown_owner",
  };
}
