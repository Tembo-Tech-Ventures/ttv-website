export interface PublicIdentitySnapshot {
  publicName: string | null;
  publicAvatarUrl: string | null;
}

export function resolvePublicProfileIdentity(profile: PublicIdentitySnapshot): {
  name: string;
  image: string | null;
} {
  return {
    name: profile.publicName ?? "TTV Builder",
    image: profile.publicAvatarUrl,
  };
}
