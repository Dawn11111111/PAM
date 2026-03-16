import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

export type LoginMethod = 'local' | 'nip07' | 'nip46';

export interface NostrProfile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  banner?: string;
}

export interface Message {
  id: string;
  sender: string;
  receiver: string;
  content: string;
  created_at: number;
  isSelf: boolean;
  error?: boolean;
}

export interface Conversation {
  pubkey: string;
  lastMessage: Message;
  profile?: NostrProfile;
  unreadCount: number;
}

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://purplepag.es'
];

export const DEFAULT_DM_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol'
];

export const KIND_DM_RELAYS = 10050;

export function formatNpub(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}

export function parseNpub(npub: string): string | null {
  try {
    const { type, data } = nip19.decode(npub);
    if (type === 'npub') return data as string;
    return null;
  } catch {
    return null;
  }
}
