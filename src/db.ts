import Dexie, { type Table } from 'dexie';
import { Message, NostrProfile, Conversation } from './types';

export class PamDatabase extends Dexie {
  messages!: Table<Message>;
  profiles!: Table<{ pubkey: string; profile: NostrProfile; timestamp: number }>;
  conversations!: Table<Conversation>;

  constructor() {
    super('PamDatabase');
    this.version(1).stores({
      messages: 'id, sender, receiver, created_at, [sender+receiver]',
      profiles: 'pubkey, timestamp',
      conversations: 'pubkey, lastMessage.created_at'
    });
  }
}

export const db = new PamDatabase();
