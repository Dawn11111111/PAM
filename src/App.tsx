import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  generateSecretKey, 
  getPublicKey, 
  SimplePool, 
  Event,
  UnsignedEvent,
  finalizeEvent,
  getEventHash,
  verifyEvent,
  nip19
} from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import * as nip46 from 'nostr-tools/nip46';
import * as nip05 from 'nostr-tools/nip05';
import { 
  Settings, 
  Smartphone,
  Shield,
  AlertTriangle,
  Loader2,
  User,
  UserPlus,
  UserMinus,
  Search,
  ArrowLeft,
  Trash2,
  RotateCcw,
  Zap,
  Send,
  X,
  Plus,
  Copy,
  Check,
  Bell,
  Type,
  Unlock,
  LogOut,
  Sun,
  Moon,
  MessageSquare,
  Image as ImageIcon,
  Mic,
  Square,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import Dexie, { type Table } from 'dexie';

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: any): Promise<any>;
    };
  }
}

// --- Types ---
export type MessageType = 'text' | 'image' | 'voice';
export type LoginMethod = 'local' | 'nip07' | 'nip46' | 'nip55';

export interface NostrProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
}

export interface Message {
  id: string;
  sender: string;
  receiver: string;
  content: string;
  created_at: number;
  isSelf: boolean;
  type: MessageType;
  error?: boolean;
}

export interface Conversation {
  pubkey: string;
  lastMessage: Message;
  unreadCount: number;
  profile?: NostrProfile;
}

export interface Contact {
  pubkey: string;
  profile?: NostrProfile;
}

// --- Components ---
const AudioPlayer = ({ src, isSelf }: { src: string; isSelf: boolean }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
      setIsMuted(vol === 0);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      audioRef.current.muted = newMuted;
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex flex-col gap-2 min-w-[240px] p-2 rounded-none ${isSelf ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
      <audio ref={audioRef} src={src} />
      <div className="flex items-center gap-3">
        <button 
          onClick={togglePlay}
          className={`p-2 rounded-none transition-colors ${isSelf ? 'hover:bg-white/10' : 'hover:bg-zinc-200 dark:hover:bg-zinc-800'}`}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        
        <div className="flex-1 flex flex-col gap-1">
          <input 
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={currentTime}
            onChange={handleSeek}
            className={`w-full h-1 rounded-none appearance-none cursor-pointer ${isSelf ? 'bg-white/30 accent-white' : 'bg-zinc-300 dark:bg-zinc-700 accent-emerald-500'}`}
          />
          <div className="flex justify-between text-[10px] font-mono opacity-70">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 px-2">
        <button onClick={toggleMute} className="opacity-70 hover:opacity-100 transition-opacity">
          {isMuted || volume === 0 ? <VolumeX size={14} /> : volume < 0.5 ? <Volume1 size={14} /> : <Volume2 size={14} />}
        </button>
        <input 
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={isMuted ? 0 : volume}
          onChange={handleVolumeChange}
          className={`w-16 h-1 rounded-none appearance-none cursor-pointer ${isSelf ? 'bg-white/30 accent-white' : 'bg-zinc-300 dark:bg-zinc-700 accent-emerald-500'}`}
        />
      </div>
    </div>
  );
};

// --- Database ---
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

const localDb = new PamDatabase();

// --- Constants ---
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://purplepag.es',
  'wss://relay.primal.net'
];

const INDEXER_RELAYS = ['wss://purplepag.es', 'wss://relay.nos.social'];

const KIND_DM = 14;
const KIND_SEAL = 13;
const KIND_GIFT_WRAP = 1059;

// --- Utilities ---
const publishWithTimeout = async (pool: SimplePool, relays: string[], event: Event, timeout = 5000) => {
  const pubs = pool.publish(relays, event);
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('publish timed out')), timeout));
  try {
    // Wait for at least one success or all to settle, but with a timeout
    await Promise.race([
      Promise.allSettled(pubs),
      timeoutPromise
    ]);
  } catch (err) {
    if (err instanceof Error && err.message === 'publish timed out') {
      console.warn('Publishing timed out, but event may have been sent to some relays.');
    } else {
      throw err;
    }
  }
};

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const formatNpub = (pubkey: string) => {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
};

// --- Components ---

const PamIcon = ({ className = "", size = 24 }: { className?: string, size?: number }) => {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" /> {/* Emerald-500 */}
          <stop offset="100%" stopColor="#3b82f6" /> {/* Blue-500 */}
        </linearGradient>
      </defs>
      <path d="M20 20L80 20L90 50L80 80L20 80L10 50L20 20Z" className="fill-white dark:fill-black transition-colors" stroke="url(#logo-grad)" strokeWidth="4" />
      <path d="M37 37V67M37 37H57C62 37 67 42 67 47C67 52 62 57 57 57H37" stroke="#3b82f6" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      <path d="M33 33V63M33 33H53C58 33 63 38 63 43C63 48 58 53 53 53H33" stroke="#10b981" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      <path d="M35 35V65M35 35H55C60 35 65 40 65 45C65 50 60 55 55 55H35" className="stroke-black dark:stroke-white transition-colors" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="80" cy="20" r="4" fill="#10b981" />
      <circle cx="20" cy="80" r="4" fill="#3b82f6" />
    </svg>
  );
};

// --- Main App ---

export default function App() {
  const [loginMethod, setLoginMethod] = useState<LoginMethod | null>(() => (localStorage.getItem('pam_login_method') as any) || null);
  const [privKey, setPrivKey] = useState<Uint8Array | null>(() => {
    const saved = localStorage.getItem('pam_privkey');
    return saved ? new Uint8Array(saved.split(',').map(Number)) : null;
  });
  const [pubKey, setPubKey] = useState<string | null>(() => {
    const saved = localStorage.getItem('pam_privkey');
    if (saved) return getPublicKey(new Uint8Array(saved.split(',').map(Number)));
    return null;
  });

  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('pam_theme') as any) || 'dark');
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{pubkey: string, profile: NostrProfile}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showLogoutWarning, setShowLogoutWarning] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [blossomServers] = useState([
    'https://blossom.band',
    'https://satellite.earth',
    'https://blossom.hazel.city',
    'https://blossom.jmoore.me',
    'https://nostr.download',
    'https://blossom.primal.net'
  ]);
  const [powDifficulty, setPowDifficulty] = useState(0);
  const [isMining, setIsMining] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showDecryptPrompt, setShowDecryptPrompt] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'contacts' | 'conversations'>(() => (localStorage.getItem('pam_sidebar_tab') as any) || 'conversations');
  const [pendingEncryptedEvents, setPendingEncryptedEvents] = useState<Event[]>([]);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('pam_font_size')) || 14);
  const fontSizes = [12, 14, 16, 18];
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [viewingProfile, setViewingProfile] = useState<any>(null);
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('pam_font_family') || 'sans');
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('pam_notifications') === 'true');
  const [bunkerUri, setBunkerUri] = useState('');
  const [showBunkerInput, setShowBunkerInput] = useState(false);
  const [userDmRelays, setUserDmRelays] = useState<string[]>(() => {
    const saved = localStorage.getItem('pam_dm_relays');
    return saved ? JSON.parse(saved) : DEFAULT_RELAYS;
  });
  const [deletedMessageIds, setDeletedMessageIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('pam_deleted_messages');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [deleteConfirmPk, setDeleteConfirmPk] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const [viewingRelays, setViewingRelays] = useState<string[]>([]);
  const [isViewingDefaultRelays, setIsViewingDefaultRelays] = useState(false);
  const [relayInfoCache, setRelayInfoCache] = useState<Record<string, any>>({});
  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const fetchRelayInfo = useCallback(async (url: string) => {
    if (relayInfoCache[url]) return relayInfoCache[url];
    try {
      const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      const httpUrl = normalizedUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      const response = await fetch(httpUrl, { headers: { 'Accept': 'application/nostr+json' } });
      if (response.ok) {
        const info = await response.json();
        setRelayInfoCache(prev => ({ ...prev, [url]: info }));
        return info;
      }
    } catch (e) {
      // console.warn(`Failed to fetch NIP-11 info for ${url}`, e);
    }
    return null;
  }, [relayInfoCache]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    localStorage.setItem('pam_sidebar_tab', sidebarTab);
  }, [sidebarTab]);

  const pool = useRef(new SimplePool());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Logic ---
  const fetchProfile = useCallback(async (pk: string, force = false, customRelays?: string[]) => {
    if (!force) {
      const cached = await localDb.profiles.get(pk);
      if (cached && Date.now() - cached.timestamp < 3600000) {
        if (pk === pubKey) setProfile(cached.profile);
        return cached.profile;
      }
    }
    const relays = customRelays || (userDmRelays.length > 0 ? [...new Set([...INDEXER_RELAYS, ...userDmRelays])] : INDEXER_RELAYS);
    const event = await pool.current.get(relays, { kinds: [0], authors: [pk] });
    if (event) {
      try {
        const p = JSON.parse(event.content);
        if (pk === pubKey) setProfile(p);
        localDb.profiles.put({ pubkey: pk, profile: p, timestamp: Date.now() });
        return p;
      } catch {}
    }
    return null;
  }, [pubKey, userDmRelays]);

  // --- Effects ---
  useEffect(() => {
    localStorage.setItem('pam_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    const fontStack = fontFamily === 'mono' ? '"JetBrains Mono", monospace' : fontFamily === 'serif' ? '"Playfair Display", serif' : '"Inter", sans-serif';
    document.documentElement.style.setProperty('--font-family', fontStack);
    document.body.style.fontFamily = fontStack;
    localStorage.setItem('pam_font_size', fontSize.toString());
    localStorage.setItem('pam_font_family', fontFamily);
  }, [fontSize, fontFamily]);

  useEffect(() => {
    if (selectedProfile) {
      const existing = contacts.find(c => c.pubkey === selectedProfile)?.profile || 
                       searchResults.find(r => r.pubkey === selectedProfile)?.profile;
      if (existing) {
        setViewingProfile(existing);
      } else {
        fetchProfile(selectedProfile).then(setViewingProfile);
      }

      // Fetch relays (Kind 10002)
      pool.current.get(DEFAULT_RELAYS, { kinds: [10002], authors: [selectedProfile] }).then(ev => {
        if (ev) {
          const rs = ev.tags.filter(t => t[0] === 'r').map(t => t[1]);
          setViewingRelays(rs);
          setIsViewingDefaultRelays(false);
          rs.forEach(fetchRelayInfo);
        } else {
          setViewingRelays(DEFAULT_RELAYS);
          setIsViewingDefaultRelays(true);
          DEFAULT_RELAYS.forEach(fetchRelayInfo);
        }
      });
    } else {
      setViewingProfile(null);
      setViewingRelays([]);
      setIsViewingDefaultRelays(false);
    }
  }, [selectedProfile, contacts, searchResults, fetchProfile, fetchRelayInfo]);

  useEffect(() => {
    if (pubKey) {
      loadLocalData();
      fetchProfile(pubKey);
      importExistingData();
    }
  }, [pubKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('pam_dm_relays', JSON.stringify(userDmRelays));
  }, [userDmRelays]);

  useEffect(() => {
    localStorage.setItem('pam_deleted_messages', JSON.stringify(Array.from(deletedMessageIds)));
  }, [deletedMessageIds]);

  // --- Logic ---
  const loadLocalData = async () => {
    const msgs = await localDb.messages.toArray();
    setMessages(msgs);
    const convs = await localDb.conversations.toArray();
    setConversations(convs);
  };

  const importExistingData = async () => {
    if (!pubKey) return;
    setIsSyncing(true);
    
    try {
      // 1. Fetch Relay List (KIND 10002) first to know where to look
      const relayEvent = await pool.current.get(DEFAULT_RELAYS, { kinds: [10002], authors: [pubKey] });
      let searchRelays = DEFAULT_RELAYS;
      if (relayEvent) {
        const writeRelays = relayEvent.tags.filter(t => t[0] === 'r' && (!t[2] || t[2] === 'write')).map(t => t[1]);
        if (writeRelays.length > 0) {
          setUserDmRelays(writeRelays);
          searchRelays = [...new Set([...DEFAULT_RELAYS, ...writeRelays])];
        }
      }

      // 2. Import Contacts (KIND 3)
      const contactEvent = await pool.current.get(searchRelays, { kinds: [3], authors: [pubKey] });
      if (contactEvent) {
        const follows = contactEvent.tags.filter(t => t[0] === 'p').map(t => t[1]);
        const contactList: Contact[] = follows.map(pk => ({ pubkey: pk }));
        setContacts(contactList);
        
        // Pre-fetch profiles for follows using discovered relays
        follows.forEach(async (pk) => {
          const p = await fetchProfile(pk, searchRelays);
          if (p) {
            setContacts(prev => prev.map(c => c.pubkey === pk ? { ...c, profile: p } : c));
          }
        });
      }

      // 3. Fetch Gift Wraps (KIND 1059)
      const events = await pool.current.querySync(searchRelays, { kinds: [KIND_GIFT_WRAP], '#p': [pubKey], limit: 100 });
      if (events.length > 0) {
        setPendingEncryptedEvents(events);
        setShowDecryptPrompt(true);
      } else {
        subscribeToMessages();
      }
    } catch (err) {
      console.error("Failed to import data:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const decryptMessages = async () => {
    if (!privKey || !pubKey) return;
    setIsDecrypting(true);
    
    for (const event of pendingEncryptedEvents) {
      try {
        const conversationKey = nip44.getConversationKey(privKey, event.pubkey);
        const sealStr = nip44.decrypt(event.content, conversationKey);
        const seal = JSON.parse(sealStr);
        if (!verifyEvent(seal)) {
          console.error("Invalid Seal signature for event", event.id);
          continue;
        }
        const rumorStr = nip44.decrypt(seal.content, nip44.getConversationKey(privKey, seal.pubkey));
        const rumor = JSON.parse(rumorStr);
        
        if (rumor.kind === KIND_DM || rumor.kind === 1222) {
          const receiverTag = rumor.tags.find((t: any) => t[0] === 'p');
          const receiver = receiverTag ? receiverTag[1] : pubKey;
          
          const msg: Message = {
            id: rumor.id || event.id, // Prefer Rumor ID for deduplication
            sender: rumor.pubkey,
            receiver: receiver,
            content: rumor.content,
            created_at: rumor.created_at,
            isSelf: rumor.pubkey === pubKey,
            type: rumor.tags.find((t: any) => t[0] === 't' && t[1] === 'image') ? 'image' : 
                  (rumor.tags.find((t: any) => t[0] === 't' && t[1] === 'voice') || rumor.kind === 1222) ? 'voice' : 'text'
          };
          
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            const next = [...prev, msg].sort((a, b) => a.created_at - b.created_at);
            localDb.messages.put(msg);
            updateConversation(msg);
            return next;
          });
        }
      } catch (e: any) {
        if (e.message?.includes('invalid MAC')) {
          console.warn("Decryption failed (invalid MAC) for event", event.id, "- likely not for this key or corrupted.");
        } else {
          console.error("Decryption failed for event", event.id, e);
        }
      }
    }
    
    setIsDecrypting(false);
    setShowDecryptPrompt(false);
    setPendingEncryptedEvents([]);
    subscribeToMessages();
  };

  const subscribeToMessages = () => {
    if (!pubKey || !privKey) return;
    const relays = userDmRelays.length > 0 ? userDmRelays : DEFAULT_RELAYS;
    const sub = pool.current.subscribeMany(relays, [
      { kinds: [KIND_GIFT_WRAP], '#p': [pubKey] }
    ], {
      onevent: async (event) => {
        try {
          const conversationKey = nip44.getConversationKey(privKey, event.pubkey);
          const sealStr = nip44.decrypt(event.content, conversationKey);
          const seal = JSON.parse(sealStr);
          if (!verifyEvent(seal)) {
            console.error("Invalid Seal signature for event", event.id);
            return;
          }
          const rumorStr = nip44.decrypt(seal.content, nip44.getConversationKey(privKey, seal.pubkey));
          const rumor = JSON.parse(rumorStr);
          if (rumor.kind === KIND_DM || rumor.kind === 1222) {
            const receiverTag = rumor.tags.find((t: any) => t[0] === 'p');
            const receiver = receiverTag ? receiverTag[1] : pubKey;

            const msg: Message = {
              id: rumor.id || event.id, // Prefer Rumor ID for deduplication
              sender: rumor.pubkey,
              receiver: receiver,
              content: rumor.content,
              created_at: rumor.created_at,
              isSelf: rumor.pubkey === pubKey,
              type: rumor.tags.find((t: any) => t[0] === 't' && t[1] === 'image') ? 'image' : 
                    (rumor.tags.find((t: any) => t[0] === 't' && t[1] === 'voice') || rumor.kind === 1222) ? 'voice' : 'text'
            };

            if (notificationsEnabled && !msg.isSelf && activeChat !== msg.sender) {
              const profile = conversations.find(c => c.pubkey === msg.sender)?.profile;
              new Notification(profile?.name || 'New Message', {
                body: msg.content,
                icon: profile?.picture || '/pam-logo.png'
              });
            }

            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev;
              const next = [...prev, msg].sort((a, b) => a.created_at - b.created_at);
              localDb.messages.put(msg);
              updateConversation(msg);
              return next;
            });
          }
        } catch (e: any) {
          if (e.message?.includes('invalid MAC')) {
            console.warn("Decryption failed (invalid MAC) for event", event.id, "- likely not for this key or corrupted.");
          } else {
            console.error("Decryption failed for event", event.id, e);
          }
        }
      }
    });
    return () => sub.close();
  };

  const updateConversation = async (msg: Message) => {
    const otherPk = msg.isSelf ? msg.receiver : msg.sender;
    setConversations(prev => {
      const existing = prev.find(c => c.pubkey === otherPk);
      const updated: Conversation = {
        pubkey: otherPk,
        lastMessage: msg,
        unreadCount: (existing?.unreadCount || 0) + (msg.isSelf || activeChat === otherPk ? 0 : 1),
        profile: existing?.profile
      };
      localDb.conversations.put(updated);
      const next = [updated, ...prev.filter(c => c.pubkey !== otherPk)];
      if (!updated.profile) fetchProfile(otherPk).then(p => p && setConversations(curr => curr.map(c => c.pubkey === otherPk ? { ...c, profile: p } : c)));
      return next;
    });
  };

  const signEvent = async (template: UnsignedEvent): Promise<Event> => {
    if (loginMethod === 'local' && privKey) return finalizeEvent(template, privKey);
    if (loginMethod === 'nip07' && window.nostr) return window.nostr.signEvent(template);
    throw new Error("No signer");
  };

  const validateDifficulty = (id: string, difficulty: number) => {
    const bytes = hexToBytes(id);
    let leadingZeros = 0;
    for (const byte of bytes) {
      if (byte === 0) leadingZeros += 8;
      else {
        leadingZeros += Math.clz32(byte) - 24;
        break;
      }
    }
    return leadingZeros >= difficulty;
  };

  const uploadToBlossom = async (blob: Blob): Promise<string> => {
    if (!privKey || !pubKey) throw new Error("Keys missing");
    
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Curated list of reliable Blossom servers with good CORS support
    const servers = [...new Set([...blossomServers])];
    console.log(`Starting upload to Blossom servers: ${servers.join(', ')}`);
    
    for (const server of servers) {
      const normalizedServer = server.endsWith('/') ? server.slice(0, -1) : server;
      try {
        console.log(`Attempting upload to ${normalizedServer}...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.warn(`Upload to ${normalizedServer} timed out after 30s`);
          controller.abort();
        }, 30000);

        const authEvent: UnsignedEvent = {
          kind: 24242,
          pubkey: pubKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['t', 'upload'],
            ['x', hashHex],
            ['size', blob.size.toString()],
            ['expiration', (Math.floor(Date.now() / 1000) + 3600).toString()],
            ['u', `${normalizedServer}/upload`]
          ],
          content: `Upload ${blob.type || 'file'} to Blossom`
        };
        const signedAuth = await signEvent(authEvent);
        const authHeader = btoa(unescape(encodeURIComponent(JSON.stringify(signedAuth))));

        // Try POST /upload first
        const response = await fetch(`${normalizedServer}/upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Nostr ${authHeader}`,
            'Content-Type': blob.type || 'application/octet-stream'
          },
          body: blob,
          mode: 'cors',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (response.ok) {
          console.log(`Successfully uploaded to ${normalizedServer} via POST`);
          try {
            const result = await response.json();
            return result.url || `${normalizedServer}/${hashHex}`;
          } catch (jsonErr) {
            return `${normalizedServer}/${hashHex}`;
          }
        } else if (response.status === 413) {
          console.error(`File too large for ${normalizedServer} (413)`);
          continue;
        }
        
        console.log(`POST to ${normalizedServer} failed with status ${response.status}. Trying PUT...`);
        
        // Fallback to PUT if POST fails
        const putController = new AbortController();
        const putTimeoutId = setTimeout(() => {
          console.warn(`PUT to ${normalizedServer} timed out after 30s`);
          putController.abort();
        }, 30000);

        const putAuthEvent = { ...authEvent, tags: [...authEvent.tags.filter(t => t[0] !== 'u'), ['u', `${normalizedServer}/${hashHex}`]] };
        const signedPutAuth = await signEvent(putAuthEvent);
        const putAuthHeader = btoa(unescape(encodeURIComponent(JSON.stringify(signedPutAuth))));

        const putResponse = await fetch(`${normalizedServer}/${hashHex}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Nostr ${putAuthHeader}`,
            'Content-Type': blob.type || 'application/octet-stream'
          },
          body: blob,
          mode: 'cors',
          signal: putController.signal
        });

        clearTimeout(putTimeoutId);

        if (putResponse.ok) {
          console.log(`Successfully uploaded to ${normalizedServer} via PUT`);
          return `${normalizedServer}/${hashHex}`;
        } else {
          console.warn(`PUT to ${normalizedServer} failed with status ${putResponse.status}`);
        }
      } catch (err) {
        console.error(`Failed to upload to ${normalizedServer}:`, err);
      }
    }
    
    showToast("Failed to upload image to any server", "error");
    throw new Error("Failed to upload to any Blossom server. This is often due to CORS restrictions on the server side. Try again or check your network connection.");
  };

  const sendMessage = async (content = newMessage, type: MessageType = 'text') => {
    if (!activeChat || !pubKey || !privKey) return;
    const text = content.trim();
    if (!text && type === 'text') return;
    setIsMining(true);
    const tempId = Math.random().toString(36).substring(7);
    const msg: Message = { id: tempId, sender: pubKey, receiver: activeChat, content: text, created_at: Math.floor(Date.now() / 1000), isSelf: true, type };
    
    // Check for NIP-44 size limit (65535 bytes)
    // Rumor + Seal + Wrap overhead means we should stay well below 65k
    if (text.length > 60000) {
      alert("Message too large. Please send a shorter text.");
      setIsMining(false);
      return;
    }

    setMessages(prev => [...prev, msg]);
    setNewMessage('');
    try {
      const rumorTemplate: UnsignedEvent = { 
        kind: type === 'voice' ? 1222 : KIND_DM, 
        pubkey: pubKey, 
        created_at: msg.created_at, 
        tags: [['p', activeChat]], 
        content: text 
      };
      if (type === 'image') rumorTemplate.tags.push(['t', 'image']);
      if (type === 'voice') rumorTemplate.tags.push(['t', 'voice']);
      const rumor = { ...rumorTemplate, id: getEventHash(rumorTemplate) };
      
      // 1. Create Seals (KIND 13)
      // Seal for Receiver
      const sealForReceiverTemplate: UnsignedEvent = {
        kind: 13,
        pubkey: pubKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: nip44.encrypt(JSON.stringify(rumor), nip44.getConversationKey(privKey, activeChat))
      };
      const signedSealForReceiver = await signEvent(sealForReceiverTemplate);

      // 2. Create Gift Wraps (KIND 1059)
      const ephemeralPriv = generateSecretKey();
      const ephemeralPub = getPublicKey(ephemeralPriv);
      const wrapCreatedAt = Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 60); // Slight randomization

      // Wrap for Receiver
      const wrapForReceiverTemplate: UnsignedEvent = {
        kind: KIND_GIFT_WRAP,
        pubkey: ephemeralPub,
        created_at: wrapCreatedAt,
        tags: [['p', activeChat]],
        content: nip44.encrypt(JSON.stringify(signedSealForReceiver), nip44.getConversationKey(ephemeralPriv, activeChat))
      };
      const signedWrapForReceiver = finalizeEvent(wrapForReceiverTemplate, ephemeralPriv);

      // Wrap for Self (if not sending to self)
      let signedWrapForSelf: Event | null = null;
      if (activeChat !== pubKey) {
        const sealForSelfTemplate: UnsignedEvent = {
          kind: 13,
          pubkey: pubKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: nip44.encrypt(JSON.stringify(rumor), nip44.getConversationKey(privKey, pubKey))
        };
        const signedSealForSelf = await signEvent(sealForSelfTemplate);

        const wrapForSelfTemplate: UnsignedEvent = {
          kind: KIND_GIFT_WRAP,
          pubkey: ephemeralPub,
          created_at: wrapCreatedAt,
          tags: [['p', pubKey]],
          content: nip44.encrypt(JSON.stringify(signedSealForSelf), nip44.getConversationKey(ephemeralPriv, pubKey))
        };
        signedWrapForSelf = finalizeEvent(wrapForSelfTemplate, ephemeralPriv);
      }
      
      // PoW Mining for Receiver's Wrap if difficulty > 0
      let finalWrapForReceiver = signedWrapForReceiver;
      if (powDifficulty > 0) {
        let nonce = 0;
        while (true) {
          const tags = [...finalWrapForReceiver.tags, ['nonce', nonce.toString(), powDifficulty.toString()]];
          const id = getEventHash({ ...finalWrapForReceiver, tags });
          if (validateDifficulty(id, powDifficulty)) {
            finalWrapForReceiver = { ...finalWrapForReceiver, id, tags };
            break;
          }
          nonce++;
          if (nonce % 1000 === 0) await new Promise(r => setTimeout(r, 0));
        }
      }

      const relays = userDmRelays.length > 0 ? userDmRelays : DEFAULT_RELAYS;
      const publishPromises = [publishWithTimeout(pool.current, relays, finalWrapForReceiver)];
      if (signedWrapForSelf) {
        publishPromises.push(publishWithTimeout(pool.current, relays, signedWrapForSelf));
      }
      await Promise.allSettled(publishPromises);
      
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: rumor.id } : m));
      localDb.messages.put({ ...msg, id: rumor.id });
      updateConversation({ ...msg, id: rumor.id });
    } catch (err) {
      console.error("Send failed", err);
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } finally {
      setIsMining(false);
    }
  };

  const loginLocal = (key: Uint8Array) => {
    const pk = getPublicKey(key);
    setPrivKey(key); setPubKey(pk); setLoginMethod('local');
    localStorage.setItem('pam_login_method', 'local');
    localStorage.setItem('pam_privkey', key.toString());
  };

  useEffect(() => {
    userDmRelays.forEach(fetchRelayInfo);
  }, [userDmRelays, fetchRelayInfo]);

  const addRelay = async () => {
    if (!newRelayUrl.trim()) return;
    let url = newRelayUrl.trim();
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      url = 'wss://' + url;
    }
    if (userDmRelays.includes(url)) {
      showToast("Relay already added", "info");
      return;
    }
    const next = [...userDmRelays, url];
    setUserDmRelays(next);
    localStorage.setItem('pam_dm_relays', JSON.stringify(next));
    setNewRelayUrl('');
    showToast("Relay added", "success");
    fetchRelayInfo(url);
  };

  const removeRelay = (url: string) => {
    const next = userDmRelays.filter(r => r !== url);
    setUserDmRelays(next);
    localStorage.setItem('pam_dm_relays', JSON.stringify(next));
    showToast("Relay removed", "success");
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording", err);
      showToast("Could not access microphone", "error");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }
  };

  const discardRecording = () => {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setRecordingDuration(0);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const loginNip07 = async () => {
    if (window.nostr) {
      try {
        const pk = await window.nostr.getPublicKey();
        setPubKey(pk); setLoginMethod('nip07');
        localStorage.setItem('pam_login_method', 'nip07');
      } catch (err) {
        alert("Extension login failed");
      }
    }
  };

  const loginNip46 = async () => {
    if (!bunkerUri) return;
    try {
      setIsSyncing(true);
      const remotePubkey = bunkerUri.split('@')[1]?.split('?')[0];
      if (!remotePubkey) throw new Error("Invalid Bunker URI");
      
      // In a real app, we'd use nip46.NostrConnect to bridge
      // For this demo, we'll simulate the pubkey acquisition
      setPubKey(remotePubkey);
      setLoginMethod('nip46');
      localStorage.setItem('pam_login_method', 'nip46');
      setShowBunkerInput(false);
    } catch (err) {
      alert("Bunker login failed");
    } finally {
      setIsSyncing(false);
    }
  };

  const loginNip55 = async () => {
    // NIP-55 is Android Signer. On web, this often relies on a bridge or specific browser support.
    // We'll attempt to use window.nostr as a fallback or proxy.
    if (window.nostr) {
      loginNip07();
    } else {
      alert("NIP-55 requires a compatible Android Nostr browser or bridge.");
    }
  };

  const logout = () => {
    localStorage.clear();
    localDb.delete().then(() => window.location.reload());
  };

  const toggleFollow = async (pk: string) => {
    if (!pubKey) return;
    const isFollowing = contacts.some(c => c.pubkey === pk);
    let newContacts: Contact[];
    
    if (isFollowing) {
      newContacts = contacts.filter(c => c.pubkey !== pk);
    } else {
      const p = await fetchProfile(pk);
      newContacts = [...contacts, { pubkey: pk, profile: p || undefined }];
    }
    
    setContacts(newContacts);
    showToast(isFollowing ? "Unfollowed" : "Followed", "success");
    
    const tags = newContacts.map(c => ['p', c.pubkey]);
    const event = {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
      pubkey: pubKey
    };
    
    const relays = userDmRelays.length > 0 ? [...new Set([...DEFAULT_RELAYS, ...userDmRelays])] : DEFAULT_RELAYS;
    try {
      const signedEvent = await signEvent(event);
      if (signedEvent) {
        await publishWithTimeout(pool.current, relays, signedEvent);
      }
    } catch (err) {
      console.error('Failed to update follows:', err);
    }
  };

  const [showClearConfirm, setShowClearConfirm] = useState<string | null>(null);

  const clearConversation = async (pk: string) => {
    try {
      // 1. Find all messages sent by the user in this conversation
      const myMessages = await localDb.messages
        .where('sender').equals(pubKey!)
        .and(m => m.receiver === pk)
        .toArray();
      
      const eventIdsToDelete = myMessages.map(m => m.id);
      
      if (eventIdsToDelete.length > 0) {
        // 2. Send Kind 5 Deletion request
        const deleteEvent = {
          kind: 5,
          created_at: Math.floor(Date.now() / 1000),
          tags: eventIdsToDelete.map(id => ['e', id]),
          content: 'Deleting messages',
          pubkey: pubKey!
        };
        
        const relays = userDmRelays.length > 0 ? userDmRelays : DEFAULT_RELAYS;
        const signedDelete = await signEvent(deleteEvent);
        if (signedDelete) {
          await publishWithTimeout(pool.current, relays, signedDelete);
        }
      }
      
      // 3. Delete locally
      await localDb.messages.where('sender').equals(pk).delete();
      await localDb.messages.where('receiver').equals(pk).delete();
      await localDb.conversations.delete(pk);
      
      setMessages(prev => prev.filter(m => m.sender !== pk && m.receiver !== pk));
      setConversations(prev => prev.filter(c => c.pubkey !== pk));
      
      if (activeChat === pk) setActiveChat(null);
      setSelectedProfile(null);
      setShowClearConfirm(null);
      showToast("Conversation cleared and deletion requested", "success");
    } catch (err) {
      console.error("Failed to clear conversation", err);
      showToast("Failed to clear conversation", "error");
    }
  };

  const deleteConversation = async (pk: string) => {
    try {
      await localDb.messages.where('sender').equals(pk).delete();
      await localDb.messages.where('receiver').equals(pk).delete();
      await localDb.conversations.delete(pk);
      
      setMessages(prev => prev.filter(m => m.sender !== pk && m.receiver !== pk));
      setConversations(prev => prev.filter(c => c.pubkey !== pk));
      
      if (activeChat === pk) setActiveChat(null);
      setSelectedProfile(null);
      setDeleteConfirmPk(null);
      showToast("Conversation deleted", "success");
    } catch (err) {
      console.error("Failed to delete conversation", err);
    }
  };

  const getInboxRelaysOfPartners = async () => {
    const pks = conversations.map(c => c.pubkey);
    if (pks.length === 0) return [];
    
    try {
      // Use DEFAULT_RELAYS to find their relay lists (Kind 10002)
      const events = await pool.current.querySync(DEFAULT_RELAYS, { kinds: [10002], authors: pks });
      const relays = new Set<string>();
      events.forEach(ev => {
        ev.tags.forEach(tag => {
          if (tag[0] === 'r' && (!tag[2] || tag[2] === 'read')) {
            relays.add(tag[1]);
          }
        });
      });
      return Array.from(relays);
    } catch (e) {
      console.error("Failed to fetch partner relays", e);
      return [];
    }
  };

  const searchOnRelays = async (relays: string[], query: string): Promise<Contact[]> => {
    try {
      // NIP-50 search filter
      const events = await pool.current.querySync(relays, { 
        kinds: [0], 
        search: query, 
        limit: 10 
      });
      return events.map(ev => {
        try {
          return { pubkey: ev.pubkey, profile: JSON.parse(ev.content) };
        } catch {
          return { pubkey: ev.pubkey };
        }
      });
    } catch (e) {
      console.warn("Search filter not supported or failed on these relays", e);
      return [];
    }
  };

  const getSecondDegreePubkeys = async () => {
    const directFollows = contacts.map(c => c.pubkey);
    if (directFollows.length === 0) return [];
    
    try {
      const searchRelays = userDmRelays.length > 0 ? [...new Set([...DEFAULT_RELAYS, ...userDmRelays])] : DEFAULT_RELAYS;
      // Fetch Kind 3 (Contact Lists) for direct follows
      const contactEvents = await pool.current.querySync(searchRelays, { kinds: [3], authors: directFollows });
      const secondDegree = new Set<string>();
      contactEvents.forEach(ev => {
        ev.tags.forEach(tag => {
          if (tag[0] === 'p') secondDegree.add(tag[1]);
        });
      });
      // Remove direct follows and self to keep it strictly 2nd degree
      directFollows.forEach(pk => secondDegree.delete(pk));
      if (pubKey) secondDegree.delete(pubKey);
      return Array.from(secondDegree);
    } catch (e) {
      console.error("Failed to fetch second degree pubkeys", e);
      return [];
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSyncing(true);
    try {
      const query = searchQuery.trim();
      const isNip05 = query.includes('@');
      
      // 1. Look in local contact list first for matching NIP-05 (including partial), name, or pubkey
      const queryLower = query.toLowerCase();
      const localMatches = contacts.filter(c => {
        const name = (c.profile?.display_name || c.profile?.name || '').toLowerCase();
        const nip05Val = (c.profile?.nip05 || '').toLowerCase();
        const pk = c.pubkey.toLowerCase();
        const npub = formatNpub(c.pubkey).toLowerCase();
        
        return name.includes(queryLower) || 
               nip05Val.includes(queryLower) || 
               pk === queryLower || 
               npub === queryLower;
      });

      if (localMatches.length > 0) {
        setSearchResults(localMatches);
        setIsSyncing(false);
        return;
      }

      // Prepare primary search relays
      const searchRelays = userDmRelays.length > 0 ? [...new Set([...DEFAULT_RELAYS, ...userDmRelays])] : DEFAULT_RELAYS;
      let targetPk = query;
      let isResolvedPubkey = false;

      if (isNip05) {
        const profile = await nip05.queryProfile(query);
        if (profile) {
          targetPk = profile.pubkey;
          isResolvedPubkey = true;
        }
      } else if (query.startsWith('npub1')) {
        try {
          const decoded = nip19.decode(query) as any;
          if (decoded.type === 'npub') {
            targetPk = decoded.data;
            isResolvedPubkey = true;
          }
        } catch (e) {}
      } else if (query.length === 64 && /^[0-9a-f]+$/.test(query)) {
        isResolvedPubkey = true;
      }

      // 2. Search on primary relays (Write relays + Default)
      if (isResolvedPubkey) {
        const p = await fetchProfile(targetPk, false, searchRelays);
        if (p) {
          setSearchResults([{ pubkey: targetPk, profile: p }]);
          setIsSyncing(false);
          return;
        }
      } else {
        // Keyword search on primary relays
        const results = await searchOnRelays(searchRelays, query);
        if (results.length > 0) {
          setSearchResults(results);
          setIsSyncing(false);
          return;
        }
      }

      // 3. Follows of Follows Search (2nd degree)
      const secondDegreePubkeys = await getSecondDegreePubkeys();
      if (secondDegreePubkeys.length > 0) {
        if (isResolvedPubkey) {
          if (secondDegreePubkeys.includes(targetPk)) {
            const p = await fetchProfile(targetPk, false, searchRelays);
            if (p) {
              setSearchResults([{ pubkey: targetPk, profile: p }]);
              setIsSyncing(false);
              return;
            }
          }
        } else {
          // For keyword search, we check if any 2nd degree connection matches
          // We fetch metadata for 2nd degree connections in batches (limited to avoid overhead)
          const batchSize = 50;
          const batches = [];
          for (let i = 0; i < Math.min(secondDegreePubkeys.length, 200); i += batchSize) {
            batches.push(secondDegreePubkeys.slice(i, i + batchSize));
          }

          for (const batch of batches) {
            const events = await pool.current.querySync(searchRelays, { kinds: [0], authors: batch });
            const matches = events.filter(ev => {
              try {
                const p = JSON.parse(ev.content);
                const name = (p.display_name || p.name || '').toLowerCase();
                const nip05Val = (p.nip05 || '').toLowerCase();
                return name.includes(queryLower) || nip05Val.includes(queryLower);
              } catch { return false; }
            }).map(ev => {
              try {
                return { pubkey: ev.pubkey, profile: JSON.parse(ev.content) };
              } catch {
                return { pubkey: ev.pubkey };
              }
            });

            if (matches.length > 0) {
              setSearchResults(matches);
              setIsSyncing(false);
              return;
            }
          }
        }
      }

      // 4. Advanced Fallback: Search inbox relays of conversation partners
      const partnerInboxRelays = await getInboxRelaysOfPartners();
      if (partnerInboxRelays.length > 0) {
        if (isResolvedPubkey) {
          const p = await fetchProfile(targetPk, false, partnerInboxRelays);
          if (p) {
            setSearchResults([{ pubkey: targetPk, profile: p }]);
            setIsSyncing(false);
            return;
          }
        } else {
          // Keyword search on partner inbox relays
          const results = await searchOnRelays(partnerInboxRelays, query);
          if (results.length > 0) {
            setSearchResults(results);
            setIsSyncing(false);
            return;
          }
        }
      }

      showToast("No results found", "info");
    } catch (err) {
      console.error('Search failed:', err);
      showToast("Search failed", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const filteredContacts = contacts.filter(c => {
    if (!searchQuery.trim()) return true;
    const name = (c.profile?.display_name || c.profile?.name || '').toLowerCase();
    const nip05 = (c.profile?.nip05 || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || nip05.includes(query) || c.pubkey.toLowerCase().includes(query);
  });

  const filteredConversations = conversations.filter(c => {
    if (!searchQuery.trim()) return true;
    const name = (c.profile?.display_name || c.profile?.name || '').toLowerCase();
    const nip05 = (c.profile?.nip05 || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || nip05.includes(query) || c.pubkey.toLowerCase().includes(query) || c.lastMessage.content.toLowerCase().includes(query);
  });

  // --- Render ---

  if (!pubKey) {
    return (
      <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white flex flex-col items-center justify-center p-8 transition-colors duration-300">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm space-y-12 text-center">
          <div className="space-y-6">
            <PamIcon size={80} className="mx-auto drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
            <div className="space-y-1">
              <h1 className="text-5xl font-black tracking-tighter italic bg-gradient-to-br from-emerald-500 via-white dark:via-white to-blue-500 bg-clip-text text-transparent">PAM_</h1>
              <p className="text-zinc-500 text-[10px] uppercase tracking-[0.3em] font-bold">Profiles and Messages</p>
            </div>
          </div>

          <div className="space-y-3">
            <button 
              onClick={() => setShowKeyInput(true)} 
              className="w-full py-4 bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white font-bold rounded-none border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 group"
            >
              <Shield size={18} className="text-emerald-500 group-hover:scale-110 transition-transform" />
              Login with Key
            </button>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => window.nostr && loginNip07()} className="py-3 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 text-[10px] font-bold rounded-none border border-zinc-200 dark:border-zinc-800 hover:text-black dark:hover:text-white transition-all flex items-center justify-center gap-1">
                <Smartphone size={12} className="text-blue-500" /> NIP-07
              </button>
              <button onClick={() => setShowBunkerInput(true)} className="py-3 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 text-[10px] font-bold rounded-none border border-zinc-200 dark:border-zinc-800 hover:text-black dark:hover:text-white transition-all flex items-center justify-center gap-1">
                <Shield size={12} className="text-emerald-500" /> NIP-46
              </button>
              <button onClick={loginNip55} className="py-3 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 text-[10px] font-bold rounded-none border border-zinc-200 dark:border-zinc-800 hover:text-black dark:hover:text-white transition-all flex items-center justify-center gap-1">
                <Smartphone size={12} className="text-blue-500" /> NIP-55
              </button>
            </div>
            <div className="pt-4">
              <button 
                onClick={() => loginLocal(generateSecretKey())} 
                className="w-full py-4 bg-black dark:bg-white text-white dark:text-black font-bold rounded-none hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all active:scale-95 shadow-lg shadow-emerald-500/10"
              >
                Start New Identity
              </button>
            </div>
          </div>

          <p className="text-[10px] text-zinc-600 leading-relaxed">
            Your keys, your messages. End-to-end encrypted via NIP-17.<br/>No servers, no tracking, just Nostr.
          </p>
        </motion.div>

        <AnimatePresence>
          {showKeyInput && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowKeyInput(false)} className="absolute inset-0 bg-black/80 dark:bg-black/90 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-8 rounded-none space-y-6 shadow-2xl">
                <div className="space-y-1">
                  <h3 className="text-xl font-bold">Login</h3>
                  <p className="text-xs text-zinc-500">Enter your nsec or hex private key</p>
                </div>
                <input 
                  type="password" 
                  placeholder="nsec1... or hex" 
                  value={keyInput} 
                  onChange={(e) => setKeyInput(e.target.value)} 
                  className="w-full bg-zinc-50 dark:bg-black border border-zinc-200 dark:border-zinc-900 rounded-none px-4 py-4 text-sm focus:outline-none focus:border-black dark:focus:border-white transition-colors" 
                />
                <button 
                  onClick={() => {
                    try {
                      let key: Uint8Array;
                      if (keyInput.startsWith('nsec1')) key = nip19.decode(keyInput).data as any;
                      else key = hexToBytes(keyInput);
                      loginLocal(key); setShowKeyInput(false); setKeyInput('');
                    } catch { alert("Invalid key"); }
                  }} 
                  className="w-full py-4 bg-black dark:bg-white text-white dark:text-black font-bold rounded-none hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-lg shadow-emerald-500/10"
                >
                  Continue
                </button>
              </motion.div>
            </div>
          )}

          {showBunkerInput && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowBunkerInput(false)} className="absolute inset-0 bg-black/80 dark:bg-black/90 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-8 rounded-none space-y-6 shadow-2xl">
                <div className="space-y-1">
                  <h3 className="text-xl font-bold">Nostr Connect</h3>
                  <p className="text-xs text-zinc-500">Enter your Bunker URI (bunker://...)</p>
                </div>
                <input 
                  type="text" 
                  placeholder="bunker://..." 
                  value={bunkerUri} 
                  onChange={(e) => setBunkerUri(e.target.value)} 
                  className="w-full bg-zinc-50 dark:bg-black border border-zinc-200 dark:border-zinc-900 rounded-none px-4 py-4 text-sm focus:outline-none focus:border-black dark:focus:border-white transition-colors" 
                />
                <button 
                  onClick={loginNip46} 
                  className="w-full py-4 bg-black dark:bg-white text-white dark:text-black font-bold rounded-none hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-lg shadow-emerald-500/10"
                >
                  Connect
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-white dark:bg-black text-black dark:text-white overflow-hidden transition-colors duration-300">
      {/* Sidebar */}
      <div className={`w-full md:w-80 border-r border-zinc-200 dark:border-zinc-900 flex flex-col ${activeChat ? 'hidden md:flex' : 'flex'}`}>
        {/* Sidebar Header */}
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-900 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSelectedProfile(pubKey)}
              className="w-10 h-10 rounded-none bg-zinc-100 dark:bg-zinc-900 overflow-hidden border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500 transition-colors"
            >
              {profile?.picture ? <img src={profile.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center"><User size={20} className="text-zinc-400 dark:text-zinc-600" /></div>}
            </button>
            <button 
              onClick={() => setSelectedProfile(pubKey)}
              className="min-w-0 text-left group"
            >
              <h2 className="font-black text-sm tracking-tighter italic leading-none group-hover:text-emerald-500 transition-colors">PAM_</h2>
              <p className="text-[9px] text-zinc-500 font-mono truncate mt-1">{formatNpub(pubKey).slice(0, 12)}...</p>
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowSettings(true)} className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-emerald-500 transition-colors">
              <Settings size={20} />
            </button>
            <button onClick={() => setShowLogoutWarning(true)} className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-red-500 transition-colors">
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-900 bg-white dark:bg-black">
          <button 
            onClick={() => setSidebarTab('conversations')}
            className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${sidebarTab === 'conversations' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-400 border-transparent hover:text-zinc-600 dark:hover:text-zinc-200'}`}
          >
            Messages
          </button>
          <button 
            onClick={() => setSidebarTab('contacts')}
            className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${sidebarTab === 'contacts' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-400 border-transparent hover:text-zinc-600 dark:hover:text-zinc-200'}`}
          >
            Contacts
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-900 bg-zinc-50/30 dark:bg-zinc-950/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
            <input 
              type="text" 
              placeholder={sidebarTab === 'contacts' ? "Search contacts or npub..." : "Search messages..."} 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()} 
              className="w-full pl-10 pr-4 py-3 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-900 rounded-none text-sm focus:outline-none focus:border-emerald-500 transition-colors" 
            />
            {isSyncing && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-emerald-500" />}
          </div>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto">
          {sidebarTab === 'contacts' ? (
            <div className="p-2 space-y-1">
              {searchResults.length > 0 ? (
                <div className="space-y-1">
                  <p className="px-2 py-1 text-[9px] font-bold text-emerald-500 uppercase tracking-widest">Global Search Results</p>
                  {searchResults.map(res => (
                    <button key={res.pubkey} onClick={() => setSelectedProfile(res.pubkey)} className="w-full p-2 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-none text-left transition-colors group">
                      <div className="w-10 h-10 rounded-none bg-zinc-100 dark:bg-zinc-900 overflow-hidden border border-zinc-200 dark:border-zinc-800 shrink-0">
                        {res.profile?.picture ? <img src={res.profile.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User size={20} className="m-auto text-zinc-400 dark:text-zinc-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold truncate group-hover:text-emerald-500 transition-colors">{res.profile?.display_name || res.profile?.name || 'Unknown'}</p>
                          {contacts.some(c => c.pubkey === res.pubkey) && (
                            <span className="px-1 py-0.5 bg-emerald-500/10 text-emerald-500 text-[8px] font-bold uppercase tracking-tighter">Followed</span>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono truncate">{formatNpub(res.pubkey).slice(0, 16)}...</p>
                      </div>
                    </button>
                  ))}
                  <button onClick={() => setSearchResults([])} className="w-full py-2 text-[9px] text-zinc-400 hover:text-black dark:hover:text-white uppercase font-bold tracking-widest">Clear Results</button>
                </div>
              ) : filteredContacts.length > 0 ? (
                filteredContacts.map(contact => (
                  <div 
                    key={contact.pubkey} 
                    className={`w-full p-2 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group rounded-none ${activeChat === contact.pubkey ? 'bg-zinc-100 dark:bg-zinc-900' : ''}`}
                  >
                    <button 
                      onClick={(e) => { e.stopPropagation(); setSelectedProfile(contact.pubkey); }}
                      className="w-10 h-10 rounded-none bg-zinc-100 dark:bg-zinc-900 overflow-hidden border border-zinc-200 dark:border-zinc-800 shrink-0 hover:border-emerald-500 transition-colors"
                    >
                      {contact.profile?.picture ? <img src={contact.profile.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User size={20} className="m-auto text-zinc-400 dark:text-zinc-600" />}
                    </button>
                    <button 
                      onClick={() => setActiveChat(contact.pubkey)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="text-sm font-bold truncate group-hover:text-emerald-500 transition-colors">{contact.profile?.display_name || contact.profile?.name || 'Unknown'}</p>
                      <p className="text-[10px] text-zinc-500 font-mono truncate">{formatNpub(contact.pubkey).slice(0, 16)}...</p>
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); toggleFollow(contact.pubkey); }}
                      className="p-2 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="Unfollow"
                    >
                      <UserMinus size={16} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center space-y-2 opacity-50">
                  <User size={24} className="mx-auto text-zinc-400" />
                  <p className="text-[10px] uppercase tracking-widest font-bold">No contacts found</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredConversations.length > 0 ? (
                filteredConversations.map(conv => (
                  <div 
                    key={conv.pubkey} 
                    className={`w-full p-4 flex items-center gap-4 rounded-none transition-all border-l-4 ${activeChat === conv.pubkey ? 'bg-zinc-50 dark:bg-zinc-900 border-emerald-500' : 'hover:bg-zinc-50 dark:hover:bg-zinc-950 border-transparent'}`}
                  >
                    <button 
                      onClick={(e) => { e.stopPropagation(); setSelectedProfile(conv.pubkey); }}
                      className="w-12 h-12 rounded-none bg-zinc-100 dark:bg-zinc-900 overflow-hidden relative border border-zinc-200 dark:border-zinc-800 shrink-0 hover:border-emerald-500 transition-colors"
                    >
                      {conv.profile?.picture ? <img src={conv.profile.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User size={24} className="m-auto text-zinc-400 dark:text-zinc-600" />}
                      {conv.unreadCount > 0 && <div className="absolute top-0 right-0 w-4 h-4 bg-emerald-500 text-white rounded-none text-[8px] font-bold flex items-center justify-center border-2 border-white dark:border-black">{conv.unreadCount}</div>}
                    </button>
                    <button 
                      onClick={() => setActiveChat(conv.pubkey)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex justify-between items-baseline mb-0.5">
                        <p className={`text-sm font-bold truncate ${activeChat === conv.pubkey ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{conv.profile?.display_name || conv.profile?.name || 'Unknown'}</p>
                        <span className="text-[9px] text-zinc-400 dark:text-zinc-600 font-mono">{formatDistanceToNow(conv.lastMessage.created_at * 1000)}</span>
                      </div>
                      <p className="text-xs truncate text-zinc-500 leading-tight">{conv.lastMessage.content}</p>
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center space-y-4 opacity-50">
                  <MessageSquare size={24} className="mx-auto text-zinc-400" />
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-widest font-bold">No active chats</p>
                    <p className="text-[9px]">Switch to Contacts to start a conversation</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`flex-1 flex flex-col bg-white dark:bg-black ${!activeChat ? 'hidden md:flex' : 'flex'}`}>
        {!activeChat ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-8">
            <PamIcon size={120} className="opacity-20 grayscale hover:grayscale-0 transition-all duration-500" />
            <div className="max-w-xs space-y-2">
              <h3 className="text-2xl font-black tracking-tighter italic bg-gradient-to-br from-emerald-500 via-zinc-400 dark:via-zinc-600 to-blue-500 bg-clip-text text-transparent">PAM_</h3>
              <p className="text-xs text-zinc-400 dark:text-zinc-600 uppercase tracking-widest font-bold">Secure Profiles and Messages</p>
            </div>
          </div>
        ) : (
          <>
            <div className="p-4 md:p-6 border-b border-zinc-200 dark:border-zinc-900 flex items-center justify-between bg-white/50 dark:bg-black/50 backdrop-blur-xl sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <button onClick={() => setActiveChat(null)} className="md:hidden p-2 text-zinc-400 dark:text-zinc-500 hover:text-emerald-500"><ArrowLeft size={20} /></button>
                <button 
                  onClick={() => setSelectedProfile(activeChat)}
                  className="w-10 h-10 rounded-none bg-zinc-100 dark:bg-zinc-900 overflow-hidden border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500 transition-colors"
                >
                  {conversations.find(c => c.pubkey === activeChat)?.profile?.picture ? <img src={conversations.find(c => c.pubkey === activeChat)?.profile?.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User size={20} className="m-auto text-zinc-400 dark:text-zinc-600" />}
                </button>
                <button 
                  onClick={() => setSelectedProfile(activeChat)}
                  className="text-left group"
                >
                  <h2 className="font-bold text-base group-hover:text-emerald-500 transition-colors">{conversations.find(c => c.pubkey === activeChat)?.profile?.display_name || conversations.find(c => c.pubkey === activeChat)?.profile?.name || 'Anonymous'}</h2>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">{formatNpub(activeChat).slice(0, 24)}...</p>
                </button>
              </div>
              <button 
                onClick={() => setActiveChat(null)} 
                className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-red-500 transition-colors"
                title="Close Chat"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {messages.filter(m => (m.sender === activeChat || m.receiver === activeChat) && !deletedMessageIds.has(m.id)).map(msg => (
                <div key={msg.id} className={`flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}>
                  <div 
                    className={`max-w-[85%] md:max-w-[70%] px-5 py-3 rounded-none leading-relaxed ${msg.isSelf ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white border border-zinc-200 dark:border-zinc-800'}`}
                  >
                    {msg.type === 'image' ? (
                      <div className="space-y-2">
                        <img src={msg.content} alt="Shared image" className="max-w-full h-auto rounded-none border border-zinc-200 dark:border-zinc-800" referrerPolicy="no-referrer" />
                        <a href={msg.content} target="_blank" rel="noopener noreferrer" className="text-[10px] underline opacity-50 hover:opacity-100 block">View original</a>
                      </div>
                    ) : msg.type === 'voice' ? (
                      <AudioPlayer src={msg.content} isSelf={msg.isSelf} />
                    ) : (
                      msg.content
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2 px-1">
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-600 uppercase font-bold tracking-wider">{formatDistanceToNow(msg.created_at * 1000)} ago</span>
                    <button onClick={() => setDeletedMessageIds(prev => new Set(prev).add(msg.id))} className="text-[9px] text-zinc-300 dark:text-zinc-800 hover:text-red-500 transition-colors">Delete</button>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-6 border-t border-zinc-200 dark:border-zinc-900 bg-white/50 dark:bg-black/50 backdrop-blur-md">
              <div className="max-w-4xl mx-auto space-y-4">
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-600 font-bold uppercase tracking-widest">
                    <Zap size={12} className={powDifficulty > 0 ? 'text-emerald-500' : ''} />
                    <span>Mining Difficulty: {powDifficulty}</span>
                  </div>
                  <input 
                    type="range" min="0" max="24" step="4" value={powDifficulty} 
                    onChange={(e) => setPowDifficulty(parseInt(e.target.value))}
                    className="w-24 h-1 bg-zinc-200 dark:bg-zinc-900 rounded-none appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="relative flex items-center gap-3">
                  {isRecording ? (
                    <div className="flex-1 flex items-center gap-4 px-6 py-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 transition-all animate-pulse">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="flex-1 text-sm font-mono text-red-500 font-bold tracking-widest">{formatDuration(recordingDuration)}</span>
                      <button 
                        onClick={stopRecording}
                        className="p-2 text-red-500 hover:bg-red-500/10 transition-colors"
                        title="Stop Recording"
                      >
                        <Square size={20} fill="currentColor" />
                      </button>
                    </div>
                  ) : audioUrl ? (
                    <div className="flex-1 flex items-center gap-4 px-4 py-2 bg-zinc-50 dark:bg-zinc-950 border border-emerald-500/30">
                      <div className="flex-1">
                        <AudioPlayer src={audioUrl} isSelf={false} />
                      </div>
                      <button 
                        onClick={discardRecording}
                        className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                        title="Discard"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  ) : (
                    <input 
                      type="text" 
                      placeholder="Message..." 
                      value={newMessage} 
                      onChange={(e) => setNewMessage(e.target.value)} 
                      onKeyDown={(e) => e.key === 'Enter' && sendMessage()} 
                      className="flex-1 px-6 py-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-none focus:outline-none focus:border-emerald-500 transition-colors" 
                    />
                  )}

                  <input 
                    type="file" 
                    id="image-upload" 
                    className="hidden" 
                    accept="image/*" 
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setIsUploading(true);
                      try {
                        const url = await uploadToBlossom(file);
                        await sendMessage(url, 'image');
                      } catch (err) {
                        alert("Failed to upload image: " + (err instanceof Error ? err.message : String(err)));
                      } finally {
                        setIsUploading(false);
                      }
                    }}
                  />

                  {!isRecording && !audioUrl && (
                    <button 
                      onClick={() => document.getElementById('image-upload')?.click()} 
                      className="p-4 bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 rounded-none hover:text-emerald-500 transition-colors"
                      title="Upload Image"
                    >
                      <ImageIcon size={20} />
                    </button>
                  )}

                  {!isRecording && !audioUrl && (
                    <button 
                      onClick={startRecording}
                      className="p-4 bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 rounded-none hover:text-red-500 transition-colors"
                      title="Record Voice Message"
                    >
                      <Mic size={20} />
                    </button>
                  )}

                  {(newMessage.trim() || audioUrl) && !isRecording && (
                    <button 
                      onClick={async () => {
                        if (audioUrl && audioBlob) {
                          setIsUploading(true);
                          try {
                            const url = await uploadToBlossom(audioBlob);
                            await sendMessage(url, 'voice');
                            discardRecording();
                          } catch (err) {
                            alert("Failed to upload voice message: " + (err instanceof Error ? err.message : String(err)));
                          } finally {
                            setIsUploading(false);
                          }
                        } else {
                          sendMessage();
                        }
                      }} 
                      disabled={isMining || isUploading} 
                      className="p-4 bg-emerald-500 text-white rounded-none disabled:opacity-50 hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20"
                    >
                      {isMining || isUploading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Profile Card Modal */}
      <AnimatePresence>
        {selectedProfile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setSelectedProfile(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 shadow-2xl overflow-hidden"
            >
              {/* Profile Background/Header */}
              <div className="h-24 bg-zinc-100 dark:bg-zinc-900 relative">
                {viewingProfile?.banner && (
                  <img src={viewingProfile.banner} alt="" className="w-full h-full object-cover opacity-50" referrerPolicy="no-referrer" />
                )}
                <button 
                  onClick={() => setSelectedProfile(null)}
                  className="absolute top-4 right-4 p-2 bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 rounded-none text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Profile Info */}
              <div className="px-6 pb-8 -mt-12 relative">
                <div className="w-24 h-24 rounded-none bg-white dark:bg-zinc-950 p-1 border border-zinc-200 dark:border-zinc-900 mb-4">
                  <div className="w-full h-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden flex items-center justify-center">
                    {!viewingProfile ? (
                      <Loader2 size={32} className="animate-spin text-emerald-500/20" />
                    ) : viewingProfile?.picture ? (
                      <img src={viewingProfile.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <User size={40} className="text-zinc-400 dark:text-zinc-600" />
                    )}
                  </div>
                </div>

                {!viewingProfile ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="h-6 bg-zinc-100 dark:bg-zinc-900 w-2/3" />
                    <div className="h-4 bg-zinc-100 dark:bg-zinc-900 w-1/2" />
                    <div className="space-y-2">
                      <div className="h-3 bg-zinc-100 dark:bg-zinc-900 w-full" />
                      <div className="h-3 bg-zinc-100 dark:bg-zinc-900 w-full" />
                      <div className="h-3 bg-zinc-100 dark:bg-zinc-900 w-3/4" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <h3 className="text-xl font-black italic tracking-tighter">
                        {viewingProfile?.display_name || viewingProfile?.name || 'Unknown User'}
                      </h3>
                      {viewingProfile?.nip05 && (
                        <p className="text-xs text-emerald-500 font-medium">{viewingProfile.nip05}</p>
                      )}
                      <p className="text-[10px] text-zinc-500 font-mono tracking-tight break-all">
                        {formatNpub(selectedProfile)}
                      </p>
                    </div>

                    {viewingProfile?.about && (
                      <div className="mt-6">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">
                          {viewingProfile.about}
                        </p>
                      </div>
                    )}

                    {viewingRelays.length > 0 && (
                      <div className="mt-6 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">DM Relays</p>
                          {isViewingDefaultRelays && (
                            <span className="text-[7px] px-1 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 uppercase font-bold tracking-tighter border border-zinc-200 dark:border-zinc-800">Default fallback</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {viewingRelays.map(url => {
                            const info = relayInfoCache[url];
                            return (
                              <div key={url} className="flex items-center gap-2 px-2 py-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-none group relative cursor-help" title={url}>
                                {info?.icon ? (
                                  <img src={info.icon} alt="" className="w-3 h-3 object-contain shrink-0" />
                                ) : (
                                  <Zap size={10} className="text-zinc-400" />
                                )}
                                <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]">
                                  {info?.name || url.replace('wss://', '').replace('ws://', '')}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Actions */}
                {selectedProfile !== pubKey && (
                  <div className="mt-8 space-y-3">
                    <div className="flex gap-3">
                      <button 
                        disabled={!viewingProfile}
                        onClick={() => {
                          if (selectedProfile) toggleFollow(selectedProfile);
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest transition-all border disabled:opacity-50 disabled:cursor-not-allowed ${
                          contacts.some(c => c.pubkey === selectedProfile)
                            ? 'bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-500 hover:border-red-500/30'
                            : 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20'
                        }`}
                      >
                        {contacts.some(c => c.pubkey === selectedProfile) ? (
                          <><UserMinus size={14} /> Unfollow</>
                        ) : (
                          <><UserPlus size={14} /> Follow</>
                        )}
                      </button>
                      <button 
                        onClick={() => {
                          setActiveChat(selectedProfile);
                          setSelectedProfile(null);
                          setSearchResults([]);
                          setSearchQuery('');
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-all"
                      >
                        <MessageSquare size={14} /> Message
                      </button>
                    </div>

                    {conversations.some(c => c.pubkey === selectedProfile) && (
                      <div className="pt-2 space-y-2">
                        {deleteConfirmPk === selectedProfile ? (
                          <div className="flex gap-2">
                            <button onClick={() => setDeleteConfirmPk(null)} className="flex-1 py-3 text-[10px] font-bold uppercase bg-zinc-100 dark:bg-zinc-900 rounded-none hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
                            <button onClick={() => deleteConversation(selectedProfile!)} className="flex-[2] py-3 text-[10px] font-bold uppercase bg-red-500 text-white rounded-none hover:bg-red-600 transition-colors">Confirm Delete Local</button>
                          </div>
                        ) : showClearConfirm === selectedProfile ? (
                          <div className="space-y-3 p-4 bg-red-50 dark:bg-red-950/20 border border-red-500/20">
                            <div className="flex items-start gap-3 text-red-600 dark:text-red-400">
                              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                              <p className="text-[10px] leading-relaxed font-medium">
                                This will send a deletion request to relays for all messages you wrote. 
                                <span className="block mt-1 font-bold">Warning: The other party may still have copies of this conversation. Only your own messages can be requested for deletion.</span>
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => setShowClearConfirm(null)} className="flex-1 py-2 text-[10px] font-bold uppercase bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-colors">Cancel</button>
                              <button onClick={() => clearConversation(selectedProfile!)} className="flex-[2] py-2 text-[10px] font-bold uppercase bg-red-600 text-white hover:bg-red-700 transition-colors">Confirm Clear & Delete</button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <button 
                              onClick={() => setDeleteConfirmPk(selectedProfile)}
                              className="flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:bg-zinc-500/10 transition-all border border-zinc-500/20 rounded-none"
                              title="Delete locally only"
                            >
                              <Trash2 size={14} /> Delete Local
                            </button>
                            <button 
                              onClick={() => setShowClearConfirm(selectedProfile)}
                              className="flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-500/10 transition-all border border-red-500/20 rounded-none"
                              title="Delete locally and request relay deletion"
                            >
                              <RotateCcw size={14} /> Clear & Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selectedProfile === pubKey && (
                  <div className="mt-8">
                    <button 
                      onClick={() => { navigator.clipboard.writeText(formatNpub(pubKey)); alert("Copied npub"); }}
                      className="w-full py-3 bg-zinc-100 dark:bg-zinc-900 text-[10px] font-bold uppercase tracking-widest rounded-none border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2"
                    >
                      <Copy size={14} className="text-blue-500" /> Copy My npub
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSettings(false)} className="absolute inset-0 bg-black/80 dark:bg-black/90 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-none p-8 space-y-8 overflow-y-auto max-h-[90vh] shadow-2xl">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">Settings</h3>
                <button onClick={() => setShowSettings(false)} className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-black dark:hover:text-white"><X size={24} /></button>
              </div>

              <div className="space-y-8">
                <div className="space-y-4">
                  <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Identity</p>
                  <div className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-none border border-zinc-200 dark:border-zinc-800 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-none bg-zinc-100 dark:bg-black border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                        {profile?.picture ? <img src={profile.picture} alt="" className="w-full h-full object-cover" /> : <User size={24} className="m-auto text-zinc-400 dark:text-zinc-700" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold truncate">{profile?.display_name || profile?.name || 'Anonymous'}</p>
                        <p className="text-[10px] text-zinc-500 font-mono truncate">{formatNpub(pubKey)}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => { navigator.clipboard.writeText(formatNpub(pubKey)); alert("Copied npub"); }}
                      className="w-full py-2 bg-white dark:bg-black text-xs font-bold rounded-none border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors flex items-center justify-center gap-2"
                    >
                      <Copy size={14} className="text-blue-500" /> Copy npub
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Appearance</p>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Theme</span>
                      <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-none border border-zinc-200 dark:border-zinc-800">
                        <button 
                          onClick={() => setTheme('light')} 
                          className={`p-2 transition-all ${theme === 'light' ? 'bg-white text-black shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                        >
                          <Sun size={14} />
                        </button>
                        <button 
                          onClick={() => setTheme('dark')} 
                          className={`p-2 transition-all ${theme === 'dark' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-400'}`}
                        >
                          <Moon size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Text Size</span>
                      <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-none border border-zinc-200 dark:border-zinc-800">
                        {fontSizes.map(size => (
                          <button 
                            key={size}
                            onClick={() => setFontSize(size)}
                            className={`px-3 py-1 text-[10px] font-bold transition-all ${fontSize === size ? 'bg-white dark:bg-zinc-800 text-black dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                          >
                            {size === 12 ? 'S' : size === 14 ? 'M' : size === 16 ? 'L' : 'XL'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Font Family</span>
                      <select 
                        value={fontFamily} 
                        onChange={(e) => setFontFamily(e.target.value)}
                        className="bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-none px-3 py-1 text-xs focus:outline-none"
                      >
                        <option value="sans">Inter (Sans)</option>
                        <option value="mono">JetBrains Mono</option>
                        <option value="serif">Playfair Display (Serif)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">DM Relays</p>
                    {userDmRelays.every(url => DEFAULT_RELAYS.includes(url)) && (
                      <span className="text-[8px] font-bold text-amber-500 uppercase tracking-tighter animate-pulse">Add custom relays for better privacy</span>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={newRelayUrl}
                        onChange={(e) => setNewRelayUrl(e.target.value)}
                        placeholder="wss://relay.example.com"
                        className="flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-none px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                        onKeyDown={(e) => e.key === 'Enter' && addRelay()}
                      />
                      <button 
                        onClick={addRelay}
                        className="px-4 py-2 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 transition-colors"
                      >
                        Add
                      </button>
                    </div>

                    {userDmRelays.every(url => DEFAULT_RELAYS.includes(url)) && (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-500/20">
                        <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                          <span className="font-bold uppercase block mb-1">Optimal Functionality Tip</span>
                          You are currently using only default relays. Adding custom DM relays (like your own or smaller community relays) can significantly improve your privacy and message reliability.
                        </p>
                      </div>
                    )}

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                      {userDmRelays.length > 0 ? (
                        userDmRelays.map(url => {
                          const info = relayInfoCache[url];
                          const isDefault = DEFAULT_RELAYS.includes(url);
                          return (
                            <div key={url} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-6 h-6 shrink-0 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 flex items-center justify-center overflow-hidden">
                                  {info?.icon ? (
                                    <img src={info.icon} alt="" className="w-full h-full object-contain" />
                                  ) : (
                                    <Zap size={12} className="text-zinc-300 dark:text-zinc-700" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-[10px] font-bold truncate">{info?.name || 'Relay'}</p>
                                    {isDefault && (
                                      <span className="text-[7px] px-1 bg-zinc-200 dark:bg-zinc-800 text-zinc-500 uppercase font-bold tracking-tighter">Default</span>
                                    )}
                                  </div>
                                  <p className="text-[8px] text-zinc-500 font-mono truncate">{url}</p>
                                </div>
                              </div>
                              <button 
                                onClick={() => removeRelay(url)}
                                className="p-1.5 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          );
                        })
                      ) : (
                        <div className="p-4 text-center border border-dashed border-zinc-200 dark:border-zinc-800 opacity-50">
                          <p className="text-[10px] uppercase tracking-widest font-bold">No relays configured</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Notifications</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Enable Desktop Notifications</span>
                    <button 
                      onClick={() => {
                        if (!notificationsEnabled) {
                          Notification.requestPermission().then(p => {
                            if (p === 'granted') {
                              setNotificationsEnabled(true);
                              localStorage.setItem('pam_notifications', 'true');
                            }
                          });
                        } else {
                          setNotificationsEnabled(false);
                          localStorage.setItem('pam_notifications', 'false');
                        }
                      }}
                      className={`w-10 h-5 rounded-none transition-colors relative ${notificationsEnabled ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800'}`}
                    >
                      <div className={`absolute top-1 w-3 h-3 rounded-none transition-all ${notificationsEnabled ? 'right-1 bg-white' : 'left-1 bg-zinc-400 dark:bg-zinc-600'}`} />
                    </button>
                  </div>
                </div>

                <div className="pt-4 space-y-3">
                  <button 
                    onClick={() => setShowLogoutWarning(true)}
                    className="w-full py-4 bg-red-500/10 text-red-500 font-bold rounded-none border border-red-500/20 hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={18} /> Logout
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showLogoutWarning && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowLogoutWarning(false)} className="absolute inset-0 bg-black/80 dark:bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-8 rounded-none text-center space-y-6 shadow-2xl">
              <AlertTriangle size={48} className="text-red-500 mx-auto" />
              <div className="space-y-2">
                <h3 className="text-2xl font-bold">Warning</h3>
                <p className="text-sm text-zinc-500">Logging out will clear all local data. Ensure you have your private key saved.</p>
              </div>
              <div className="space-y-3">
                <button 
                  onClick={() => {
                    if (privKey) {
                      const nsec = nip19.nsecEncode(privKey);
                      const blob = new Blob([nsec], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = 'pam-key.txt'; a.click();
                    }
                    logout();
                  }} 
                  className="w-full py-4 bg-black dark:bg-white text-white dark:text-black font-bold rounded-none hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                >
                  Export & Logout
                </button>
                <button onClick={logout} className="w-full py-4 bg-red-500/10 text-red-500 font-bold rounded-none hover:bg-red-500/20 transition-colors">Logout Anyway</button>
                <button onClick={() => setShowLogoutWarning(false)} className="w-full py-4 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 font-bold rounded-none hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
              </div>
            </motion.div>
          </div>
        )}

        {showDecryptPrompt && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/80 dark:bg-black/95 backdrop-blur-xl" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-8 rounded-none text-center space-y-8 shadow-2xl">
              <div className="w-20 h-20 bg-zinc-100 dark:bg-zinc-900 rounded-none flex items-center justify-center mx-auto border border-zinc-200 dark:border-zinc-800">
                <Unlock size={32} className="text-emerald-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-bold">Decrypt Messages</h3>
                <p className="text-sm text-zinc-500">We found {pendingEncryptedEvents.length} encrypted messages. Would you like to decrypt them now?</p>
              </div>
              <div className="space-y-3">
                <button 
                  onClick={decryptMessages} 
                  disabled={isDecrypting}
                  className="w-full py-4 bg-emerald-500 text-white font-bold rounded-none hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  {isDecrypting ? <Loader2 size={18} className="animate-spin" /> : <Unlock size={18} />}
                  {isDecrypting ? 'Decrypting...' : 'Decrypt Now'}
                </button>
                <button onClick={() => { setShowDecryptPrompt(false); subscribeToMessages(); }} className="w-full py-4 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 font-bold rounded-none hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">Skip for Now</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 bg-black dark:bg-white text-white dark:text-black text-[10px] font-bold uppercase tracking-widest shadow-2xl flex items-center gap-3 border border-zinc-800 dark:border-zinc-200"
          >
            {toast.type === 'success' && <Check size={14} className="text-emerald-500" />}
            {toast.type === 'error' && <AlertTriangle size={14} className="text-red-500" />}
            {toast.type === 'info' && <Shield size={14} className="text-blue-500" />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
