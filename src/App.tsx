import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  generateSecretKey, 
  getPublicKey, 
  SimplePool, 
  Event,
  UnsignedEvent,
  VerifiedEvent,
  finalizeEvent,
  getEventHash,
  verifyEvent,
  nip19,
  Relay
} from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import * as nip46 from 'nostr-tools/nip46';
import * as nip05 from 'nostr-tools/nip05';
import { 
  Settings, 
  Smartphone,
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  User,
  UserPlus,
  UserMinus,
  UserCheck,
  Search,
  Star,
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
  Key,
  MessageSquare,
  Image as ImageIcon,
  Mic,
  Square,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  HardDrive,
  Download,
  CheckCircle,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import Dexie, { type Table } from 'dexie';
import Fuse from 'fuse.js';

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: any): Promise<any>;
      nip04?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
      nip44?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
    };
  }
}

// --- Types ---
export type MessageType = 'text' | 'image' | 'voice';
export type LoginMethod = 'local' | 'nip07' | 'nip46';

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
  duration?: number;
  mimeType?: string;
  error?: boolean;
}

export interface Conversation {
  pubkey: string;
  lastMessage: Message;
  unreadCount: number;
  profile?: NostrProfile;
}

export interface NostrTrustScore {
  id: string;
  pubkey: string;
  content: string;
  score: number;
  created_at: number;
}

export interface Contact {
  pubkey: string;
  profile?: NostrProfile;
  isWoT?: boolean;
  isPriority?: boolean;
  followedBy?: string[]; // Pubkeys of people who follow this person
  trustScores?: NostrTrustScore[];
  petname?: string; // NIP-02 petname
}

// --- Components ---
const AudioPlayer = ({ src, isSelf, initialDuration, mimeType }: { src: string; isSelf: boolean; initialDuration?: number; mimeType?: string }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [error, setError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);

  // Handle src changes and initial setup
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setError(null);
    setWaveform([]);
    
    // If it's already a blob, use it immediately
    if (src.startsWith('blob:')) {
      setCurrentSrc(src);
    } else {
      setCurrentSrc(null); // Wait for processAudio to fetch and create a local blob
    }
    
    processAudio(src);
  }, [src]);

  // Handle audio element events and loading
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => {
      if (audio.duration && audio.duration !== Infinity) {
        setDuration(audio.duration);
      }
    };
    const onEnded = () => setIsPlaying(false);
    const onError = (e: any) => {
      // Ignore errors if we haven't even set a source yet
      if (!currentSrc) return;
      
      console.error("AudioPlayer Error:", {
        code: audio.error?.code,
        message: audio.error?.message,
        currentSrc,
        originalSrc: src,
        mimeType,
        event: e
      });
      
      if (audio.error) {
        let msg = "Playback error";
        switch (audio.error.code) {
          case 1: msg = "Playback aborted"; break;
          case 2: msg = "Network error"; break;
          case 3: msg = "Decoding error"; break;
          case 4: msg = "Format not supported"; break;
        }
        setError(msg);
      }
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('durationchange', updateDuration);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    // Force load when currentSrc is set
    if (currentSrc && audio) {
      audio.load();
    }

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('durationchange', updateDuration);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [currentSrc]);

  const processAudio = async (audioUrl: string) => {
    if (!audioUrl) return;
    setIsLoading(true);
    
    try {
      // 1. Fetch the audio data
      // This helps bypass range request issues and allows us to fix MIME types
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      let blob = await response.blob();
      
      // 2. Fix MIME type if generic or missing
      const effectiveMimeType = mimeType || 'audio/mp4';
      if (blob.type === 'application/octet-stream' || !blob.type || (mimeType && blob.type !== mimeType)) {
        blob = new Blob([blob], { type: effectiveMimeType });
      }
      
      // 3. Create a local URL for playback
      // We always create a new local URL for the fetched blob to ensure 
      // consistent playback and to avoid issues with original URLs.
      const localUrl = URL.createObjectURL(blob);

      // 4. Generate Waveform
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      try {
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const rawData = audioBuffer.getChannelData(0);
        const samples = 40;
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData = [];
        for (let i = 0; i < samples; i++) {
          let blockStart = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum = sum + Math.abs(rawData[blockStart + j]);
          }
          filteredData.push(sum / blockSize);
        }
        const multiplier = Math.pow(Math.max(...filteredData), -1);
        setWaveform(filteredData.map(n => n * multiplier));
      } catch (decodeErr) {
        console.warn("Audio decoding for waveform failed:", decodeErr);
        setWaveform(Array.from({ length: 40 }, () => Math.random() * 0.5 + 0.1));
      } finally {
        await audioCtx.close();
      }

      // 5. Set the local URL for playback after processing
      setCurrentSrc(localUrl);
    } catch (e) {
      console.warn("Audio processing failed, falling back to original src:", e);
      setWaveform(Array.from({ length: 40 }, () => Math.random() * 0.5 + 0.1));
      
      // Fallback to original src if fetch failed and it's not already a blob
      if (!src.startsWith('blob:')) {
        setCurrentSrc(src);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Cleanup local URLs
  useEffect(() => {
    return () => {
      if (currentSrc && currentSrc.startsWith('blob:') && currentSrc !== src) {
        URL.revokeObjectURL(currentSrc);
      }
    };
  }, [currentSrc, src]);

  const togglePlay = async () => {
    if (!audioRef.current || !currentSrc) return;
    
    if (audioRef.current.error) {
      console.error("Audio element has error before play:", audioRef.current.error);
      setError(`Playback failed: ${audioRef.current.error.message || 'Source not supported'}`);
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
        setError(null);
      } catch (e) {
        console.error("Playback failed:", e);
        setError("Playback failed");
      }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * duration;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || time === Infinity) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex flex-col gap-2 min-w-[200px] w-full p-2 ${isSelf ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
      <audio 
        key={currentSrc || 'no-src'}
        ref={audioRef} 
        src={currentSrc || undefined}
        preload="metadata" 
        className="hidden"
      />
      
      <div className="flex items-center gap-4">
        <button 
          onClick={togglePlay}
          disabled={!currentSrc || isLoading}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-sm flex-shrink-0 disabled:opacity-50 ${isSelf ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500'}`}
        >
          {isLoading ? (
            <Loader2 size={24} className="animate-spin" />
          ) : isPlaying ? (
            <Pause size={24} fill="currentColor" />
          ) : (
            <Play size={24} fill="currentColor" className="ml-1" />
          )}
        </button>
        
        <div className="flex-1 flex flex-col gap-1">
          <div 
            className="relative h-10 flex items-end gap-[2px] cursor-pointer group"
            onClick={handleSeek}
          >
            {waveform.length > 0 ? (
              waveform.map((val, i) => {
                const progress = (currentTime / duration) || 0;
                const isPlayed = (i / waveform.length) < progress;
                return (
                  <div 
                    key={i}
                    className={`flex-1 rounded-full transition-all duration-200 ${isPlayed ? (isSelf ? 'bg-white' : 'bg-emerald-500') : (isSelf ? 'bg-white/30' : 'bg-zinc-300 dark:bg-zinc-700')}`}
                    style={{ height: `${Math.max(10, val * 100)}%` }}
                  />
                );
              })
            ) : (
              <div className="w-full h-full flex items-center justify-center opacity-20">
                <div className="flex gap-1">
                  {[1,2,3,4,5].map(i => (
                    <motion.div 
                      key={i}
                      animate={{ height: [8, 20, 8] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.1 }}
                      className={`w-1 rounded-full ${isSelf ? 'bg-white' : 'bg-emerald-500'}`}
                    />
                  ))}
                </div>
              </div>
            )}
            
            {/* Hover indicator */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
              <div 
                className={`absolute top-0 bottom-0 w-[1px] ${isSelf ? 'bg-white/50' : 'bg-emerald-500/50'}`}
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />
            </div>
          </div>
          
          <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest opacity-60">
            <span>{formatTime(currentTime)}</span>
            <div className="flex items-center gap-2">
              {error && <span className="text-red-500 lowercase font-normal">{error}</span>}
              <span>{formatTime(duration)}</span>
            </div>
          </div>
        </div>

        <a 
          href={src} 
          download={`voice-note-${Date.now()}.${mimeType?.includes('mp4') ? 'm4a' : (mimeType?.split('/')[1]?.split(';')[0] || 'm4a')}`}
          className={`p-2 rounded-full transition-colors ${isSelf ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-400 hover:text-zinc-600'}`}
          title="Download Audio"
          onClick={(e) => e.stopPropagation()}
        >
          <Download size={16} />
        </a>
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

const INDEXER_RELAYS = [
  'wss://purplepag.es', 
  'wss://relay.nos.social', 
  'wss://relay.nostr.band', 
  'wss://nos.lol', 
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://relay.vertexlab.io'
];

const KIND_DM = 14;
const KIND_SEAL = 13;
const KIND_GIFT_WRAP = 1059;
const KIND_REVIEW = 1985; // NIP-85 Label
const DEFAULT_BLOSSOM_SERVERS = [
  'https://blossom.primal.net',
  'https://blossom.nostr.build',
  'https://nostr.download',
  'https://blossom.v0l.io',
  'https://blossom.lucas.online'
];

const KIND_BLOSSOM_LIST = 10063;
const KIND_RELAY_INFO = 30166; // NIP-66
const KIND_DM_RELAYS = 10050;
const KIND_RELAY_LIST = 10002;

const parseTrustScore = (event: Event): NostrTrustScore | null => {
  if (!event || !event.tags) return null;
  // NIP-85 Label can use 'rating' tag or 'l' tag with 'trust' namespace
  const ratingTag = event.tags.find(t => t[0] === 'rating');
  const labelTag = event.tags.find(t => t[0] === 'l' && t[2] === 'trust');
  
  let score = 0;
  if (ratingTag) {
    score = parseFloat(ratingTag[1]);
  } else if (labelTag) {
    // Handle numeric labels or string labels like 'trusted'
    const val = labelTag[1];
    if (!isNaN(parseFloat(val))) {
      score = parseFloat(val);
    } else if (val === 'trusted') {
      score = 1.0;
    } else if (val === 'untrusted' || val === 'distrusted') {
      score = 0.0;
    }
  } else {
    // If no explicit score tag, but it's a Kind 1985 labeling a person, 
    // we might treat it as a neutral or positive signal depending on content
    return null;
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    score,
    created_at: event.created_at
  };
};

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

const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

const formatNpub = (pubkey: string) => {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
};

const SEARCH_RELAYS = [
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://relay.damus.io',
  'wss://purplerelay.com',
  'wss://relay.vertexlab.io'
];

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

const HexagonAvatar = ({ src, size = 40, className = "", onClick, fallback }: { src?: string, size?: number, className?: string, onClick?: () => void, fallback?: React.ReactNode }) => {
  return (
    <div 
      onClick={onClick}
      className={`relative hexagon bg-gradient-to-br from-emerald-500 to-blue-500 p-[1.5px] shrink-0 transition-all duration-500 ${onClick ? 'cursor-pointer' : ''} ${className}`} 
      style={{ width: size, height: size }}
    >
      <div className="w-full h-full hexagon bg-zinc-100 dark:bg-zinc-900 overflow-hidden flex items-center justify-center">
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          fallback || <User size={size * 0.5} className="text-zinc-400 dark:text-zinc-600" />
        )}
      </div>
    </div>
  );
};

const ProfileBadges = ({ isFollowed, isPriority, isWoT, followedByCount, className = "" }: { isFollowed?: boolean, isPriority?: boolean, isWoT?: boolean, followedByCount?: number, className?: string }) => {
  if (!isFollowed && !isPriority && !isWoT) return null;
  
  return (
    <div className={`flex flex-wrap gap-1 shrink-0 items-center ${className}`}>
      {isFollowed && (
        <span className="px-1.5 py-0.5 bg-emerald-500 text-white text-[7px] font-black uppercase tracking-tighter flex items-center gap-0.5 rounded-none shadow-sm whitespace-nowrap">
          <UserCheck size={8} strokeWidth={2.5} /> Followed
        </span>
      )}
      {isPriority && (
        <span className="px-1.5 py-0.5 bg-amber-500 text-white text-[7px] font-black uppercase tracking-tighter flex items-center gap-0.5 rounded-none shadow-sm whitespace-nowrap">
          <ShieldCheck size={8} strokeWidth={2.5} /> Priority
        </span>
      )}
      {isWoT && (
        <span className="px-1.5 py-0.5 bg-blue-500 text-white text-[7px] font-black uppercase tracking-tighter flex items-center gap-0.5 rounded-none shadow-sm whitespace-nowrap">
          <Users size={8} strokeWidth={2.5} /> WoT {followedByCount && followedByCount > 1 ? `(${followedByCount})` : ''}
        </span>
      )}
    </div>
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
  const [isSyncingMessages, setIsSyncingMessages] = useState(false);

  const syncMessages = async () => {
    if (!pubKey) return;
    setIsSyncingMessages(true);
    try {
      const messageRelays = [...new Set([
        ...INDEXER_RELAYS,
        ...DEFAULT_RELAYS, 
        ...userDmRelays, 
        ...userGeneralRelays,
        ...viewingDmRelays,
        ...viewingRelays
      ])].slice(0, 30);
      
      console.log(`Manual sync: querying ${messageRelays.length} relays...`);
      const validMessages = messages.filter(Boolean);
      const latestMsg = validMessages.length > 0 ? validMessages.reduce((prev, curr) => prev.created_at > curr.created_at ? prev : curr) : null;
      const since = latestMsg ? latestMsg.created_at + 1 : 0;

      const events = await pool.current.querySync(messageRelays, {
        kinds: [KIND_GIFT_WRAP],
        '#p': [pubKey],
        since,
        limit: 500
      });

      if (events.length > 0) {
        setPendingEncryptedEvents(prev => {
          const existingIds = new Set(prev.filter(Boolean).map(e => e.id));
          const newEvents = events.filter(e => e && !existingIds.has(e.id));
          if (newEvents.length === 0) return prev;
          setShowDecryptPrompt(true);
          return [...prev.filter(Boolean), ...newEvents];
        });
        showToast(`Found ${events.length} new events`, "success");
      } else {
        showToast("No new messages found", "info");
      }
    } catch (err) {
      console.error("Manual sync failed", err);
      showToast("Sync failed", "error");
    } finally {
      setIsSyncingMessages(false);
    }
  };
  const [lastSyncTime, setLastSyncTime] = useState<number>(() => Number(localStorage.getItem('pam_last_sync')) || 0);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Contact[]>([]);
  const [priorityPubkeys, setPriorityPubkeys] = useState<string[]>(() => {
    const saved = localStorage.getItem('pam_priority_pubkeys');
    return saved ? JSON.parse(saved) : [];
  });
  const [wotPubkeys, setWotPubkeys] = useState<string[]>([]);
  const [wotFollowMap, setWotFollowMap] = useState<Record<string, string[]>>({});
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    const fetchWoT = async () => {
      if (contacts.length > 0) {
        const { secondDegree, followMap } = await getWoTPubkeys();
        setWotPubkeys(secondDegree);
        setWotFollowMap(followMap);
      }
    };
    fetchWoT();
  }, [contacts.length]);

  const getDisplayName = (pk: string | null, profile?: NostrProfile) => {
    if (!pk) return 'Anonymous';
    const contact = contacts.filter(Boolean).find(c => c.pubkey === pk);
    if (contact?.petname) return contact.petname;
    return profile?.display_name || profile?.name || 'Anonymous';
  };

  const getMessagePreview = (msg?: Message) => {
    if (!msg) return null;
    if (msg.type === 'image') return '📷 Image';
    if (msg.type === 'voice') return '🎤 Voice message';
    return msg.content;
  };

  const [isSearching, setIsSearching] = useState(false);
  const [searchAbortController, setSearchAbortController] = useState<AbortController | null>(null);
  const [petnameInput, setPetnameInput] = useState('');
  const [isEditingPetname, setIsEditingPetname] = useState(false);

  const [newMessage, setNewMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'relays' | 'blossom'>((localStorage.getItem('pam_settings_tab') as any) || 'general');
  const [showLogoutWarning, setShowLogoutWarning] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [blossomServers] = useState(DEFAULT_BLOSSOM_SERVERS);
  const [userBlossomServers, setUserBlossomServers] = useState<string[]>(() => {
    const saved = localStorage.getItem('pam_blossom_servers');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Migration: Remove known broken or problematic servers
          const badServers = [
            'blossom.band',
            'blossom.jmoore.me',
            'satellite.earth',
            'blossom.hazel.city'
          ];
          const filtered = parsed.filter(s => !badServers.some(bad => s.includes(bad)));
          
          // If the list is now empty or significantly different from defaults, 
          // and it was likely an old default list, just reset to new defaults
          if (filtered.length === 0 || (parsed.length <= 5 && filtered.length < parsed.length)) {
            return DEFAULT_BLOSSOM_SERVERS;
          }
          return filtered;
        }
      } catch (e) {
        return DEFAULT_BLOSSOM_SERVERS;
      }
    }
    return DEFAULT_BLOSSOM_SERVERS;
  });
  const [hasPublishedBlossomList, setHasPublishedBlossomList] = useState<boolean>(() => {
    return localStorage.getItem('pam_has_blossom_list') === 'true';
  });
  const [preferredBlossomServer, setPreferredBlossomServer] = useState<string | null>(() => localStorage.getItem('pam_preferred_blossom'));
  const [powDifficulty, setPowDifficulty] = useState(0);
  const [isMining, setIsMining] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showDecryptPrompt, setShowDecryptPrompt] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'contacts' | 'conversations' | 'priority'>(() => (localStorage.getItem('pam_sidebar_tab') as any) || 'conversations');
  const [pendingEncryptedEvents, setPendingEncryptedEvents] = useState<Event[]>([]);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('pam_font_size')) || 14);
  const fontSizes = [12, 14, 16, 18];
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);

  useEffect(() => {
    if (selectedProfile) {
      const contact = contacts.filter(Boolean).find(c => c.pubkey === selectedProfile);
      setPetnameInput(contact?.petname || '');
      setIsEditingPetname(false);
    }
  }, [selectedProfile, contacts]);
  const [viewingProfile, setViewingProfile] = useState<any>(null);
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('pam_font_family') || 'sans');
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('pam_notifications') === 'true');
  const [sendDelayEnabled, setSendDelayEnabled] = useState(() => localStorage.getItem('pam_send_delay') === 'true');
  const [pendingMessages, setPendingMessages] = useState<Record<string, { timeoutId: number; timeLeft: number; content: string; type: MessageType; duration?: number; mimeType?: string }>>({});
  const [bunkerUri, setBunkerUri] = useState('');
  const [showBunkerInput, setShowBunkerInput] = useState(false);
  const [showBlossomMenu, setShowBlossomMenu] = useState(false);
  const [bunkerSession, setBunkerSession] = useState<{ remotePubkey: string; localPrivkey: Uint8Array; relay: string } | null>(() => {
    const saved = localStorage.getItem('pam_bunker_session');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...parsed, localPrivkey: hexToBytes(parsed.localPrivkey) };
    }
    return null;
  });
  const [userDmRelays, setUserDmRelays] = useState<string[]>(() => {
    const saved = localStorage.getItem('pam_dm_relays');
    return saved ? JSON.parse(saved) : DEFAULT_RELAYS;
  });
  const [userGeneralRelays, setUserGeneralRelays] = useState<string[]>(() => {
    const saved = localStorage.getItem('pam_general_relays');
    return saved ? JSON.parse(saved) : DEFAULT_RELAYS;
  });
  const [relayDiscovery, setRelayDiscovery] = useState<Record<string, any>>({});
  const [deletedMessageIds, setDeletedMessageIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('pam_deleted_messages');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [deleteConfirmPk, setDeleteConfirmPk] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const [viewingRelays, setViewingRelays] = useState<string[]>([]);
  const [viewingDmRelays, setViewingDmRelays] = useState<string[]>([]);
  const [isViewingDefaultRelays, setIsViewingDefaultRelays] = useState(false);
  const [relayInfoCache, setRelayInfoCache] = useState<Record<string, any>>({});
  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [newBlossomUrl, setNewBlossomUrl] = useState('');
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
  const fetchBlossomServers = useCallback(async (pk: string) => {
    const relays = userDmRelays.length > 0 ? userDmRelays : DEFAULT_RELAYS;
    const event = await pool.current.get(relays, { kinds: [KIND_BLOSSOM_LIST], authors: [pk] });
    if (event) {
      setHasPublishedBlossomList(true);
      localStorage.setItem('pam_has_blossom_list', 'true');
      const servers = event.tags.filter(t => t[0] === 'server').map(t => t[1]);
      if (servers.length > 0) {
        setUserBlossomServers(servers);
        localStorage.setItem('pam_blossom_servers', JSON.stringify(servers));
      }
    } else {
      setHasPublishedBlossomList(false);
      localStorage.setItem('pam_has_blossom_list', 'false');
    }
  }, [userDmRelays]);

  const saveBlossomServers = async (servers: string[]) => {
    if (!pubKey || !privKey) return;
    const event: UnsignedEvent = {
      kind: KIND_BLOSSOM_LIST,
      pubkey: pubKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: servers.map(s => ['server', s]),
      content: ''
    };
    const signed = await signEvent(event);
    const relays = userDmRelays.length > 0 ? userDmRelays : DEFAULT_RELAYS;
    await publishWithTimeout(pool.current, relays, signed);
    setHasPublishedBlossomList(true);
    localStorage.setItem('pam_has_blossom_list', 'true');
    setUserBlossomServers(servers);
    localStorage.setItem('pam_blossom_servers', JSON.stringify(servers));
    showToast("Blossom servers saved", "success");
  };

  const viewingTrustInfo = useMemo(() => {
    if (!selectedProfile || contacts.length === 0) return { followedBy: [] };
    
    const searchRes = searchResults.find(r => r.pubkey === selectedProfile);
    if (searchRes) {
      return { 
        followedBy: searchRes.followedBy || [] 
      };
    }
    
    return { followedBy: [] };
  }, [selectedProfile, searchResults, contacts.length]);

  const fetchTrustScores = useCallback(async (pk: string, signal?: AbortSignal) => {
    if (signal?.aborted) return [];
    const relays = [...DEFAULT_RELAYS, ...SEARCH_RELAYS];
    try {
      const events = await Promise.race([
        pool.current.querySync(relays, { kinds: [KIND_REVIEW], '#p': [pk] }),
        new Promise<Event[]>((_, reject) => {
          const timeoutId = setTimeout(() => reject(new Error('Trust scores timeout')), 5000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            reject(new Error('AbortError'));
          });
        })
      ]);
      if (signal?.aborted) return [];
      return (events || []).filter(Boolean).map(parseTrustScore).filter((r): r is NostrTrustScore => r !== null);
    } catch (e) {
      if (e instanceof Error && e.message === 'AbortError') return [];
      console.warn("Fetch trust scores failed", e);
      return [];
    }
  }, []);

  const fetchProfile = useCallback(async (pk: string, force = false, customRelays?: string[], signal?: AbortSignal) => {
    if (signal?.aborted) return null;
    if (!force) {
      const cached = await localDb.profiles.get(pk);
      if (cached && Date.now() - cached.timestamp < 3600000) {
        if (pk === pubKey) setProfile(cached.profile);
        return cached.profile;
      }
    }
    if (signal?.aborted) return null;
    const relays = customRelays || (userGeneralRelays.length > 0 ? [...new Set([...INDEXER_RELAYS, ...userGeneralRelays, ...userDmRelays])] : [...new Set([...INDEXER_RELAYS, ...DEFAULT_RELAYS])]);
    try {
      const event = await Promise.race([
        pool.current.get(relays, { kinds: [0], authors: [pk] }),
        new Promise<Event | null>((_, reject) => {
          const timeoutId = setTimeout(() => reject(new Error('Profile fetch timeout')), 10000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            reject(new Error('AbortError'));
          });
        })
      ]);
      if (signal?.aborted) return null;
      if (event) {
        try {
          const p = JSON.parse(event.content);
          if (pk === pubKey) setProfile(p);
          localDb.profiles.put({ pubkey: pk, profile: p, timestamp: Date.now() });
          return p;
        } catch {}
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'AbortError') return null;
      console.warn("Fetch profile failed", e);
    }
    return null;
  }, [pubKey, userDmRelays, userGeneralRelays]);

  // --- Effects ---
  const [viewingTrustScores, setViewingTrustScores] = useState<NostrTrustScore[]>([]);
  const [showTrustScoreForm, setShowTrustScoreForm] = useState(false);
  const [trustScoreValue, setTrustScoreValue] = useState(1.0);
  const [trustScoreContext, setTrustScoreContext] = useState('');

  useEffect(() => {
    if (selectedProfile) {
      fetchTrustScores(selectedProfile).then(setViewingTrustScores);
    } else {
      setViewingTrustScores([]);
    }
  }, [selectedProfile, fetchTrustScores]);

  useEffect(() => {
    // Handle NIP-55 return values from URL
    const url = new URL(window.location.href);
    const urlPubKey = url.searchParams.get('pubKey') || url.searchParams.get('pubkey');
    if (urlPubKey && !pubKey) {
      setPubKey(urlPubKey);
      // NIP-55 is no longer supported in login UI
      // setLoginMethod('nip55');
      localStorage.setItem('pam_login_method', 'nip55');
      localStorage.setItem('pam_pubkey', urlPubKey);
      showToast("Logged in via Android Signer", "success");
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [pubKey]);

  useEffect(() => {
    if (pubKey) {
      fetchProfile(pubKey);
      fetchBlossomServers(pubKey);
    }
  }, [pubKey, fetchProfile, fetchBlossomServers]);

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
      const existing = contacts.filter(Boolean).find(c => c.pubkey === selectedProfile)?.profile || 
                       searchResults.find(r => r.pubkey === selectedProfile)?.profile;
       const updateRelays = async (profile: any) => {
        setIsSyncingMessages(true);
        const searchRelays = [...new Set([...INDEXER_RELAYS, ...DEFAULT_RELAYS])];
        
        // 1. Fetch Relay List (Kind 10002)
        const relayEv = await pool.current.get(searchRelays, { kinds: [KIND_RELAY_LIST], authors: [selectedProfile] });
        let generalRelays = DEFAULT_RELAYS;
        
        if (relayEv) {
          const rs = relayEv.tags.filter(t => t[0] === 'r').map(t => t[1]);
          setViewingRelays(rs);
          setIsViewingDefaultRelays(false);
          rs.forEach(fetchRelayInfo);
          generalRelays = rs;
        } else {
          // Fallback to metadata relays if present (Kind 0)
          if (profile?.relays && typeof profile.relays === 'object') {
            const rs = Object.keys(profile.relays);
            if (rs.length > 0) {
              setViewingRelays(rs);
              setIsViewingDefaultRelays(false);
              rs.forEach(fetchRelayInfo);
              generalRelays = rs;
            } else {
              setViewingRelays(DEFAULT_RELAYS);
              setIsViewingDefaultRelays(true);
              DEFAULT_RELAYS.forEach(fetchRelayInfo);
            }
          } else {
            setViewingRelays(DEFAULT_RELAYS);
            setIsViewingDefaultRelays(true);
            DEFAULT_RELAYS.forEach(fetchRelayInfo);
          }
        }

        // 2. Fetch DM Relays (Kind 10050)
        let dmEv = await pool.current.get(searchRelays, { kinds: [KIND_DM_RELAYS], authors: [selectedProfile] });
        if (!dmEv && generalRelays.length > 0) {
          dmEv = await pool.current.get(generalRelays, { kinds: [KIND_DM_RELAYS], authors: [selectedProfile] });
        }

        let contactDmRelays: string[] = [];
        if (dmEv) {
          contactDmRelays = dmEv.tags.filter(t => t[0] === 'r').map(t => t[1]);
          setViewingDmRelays(contactDmRelays);
          contactDmRelays.forEach(fetchRelayInfo);
        } else {
          // Fallback to metadata dm_relays if present (rare but possible)
          if (profile?.dm_relays && Array.isArray(profile.dm_relays)) {
            contactDmRelays = profile.dm_relays;
            setViewingDmRelays(contactDmRelays);
            contactDmRelays.forEach(fetchRelayInfo);
          } else if (profile?.dm_relays && typeof profile.dm_relays === 'object') {
            contactDmRelays = Object.keys(profile.dm_relays);
            setViewingDmRelays(contactDmRelays);
            contactDmRelays.forEach(fetchRelayInfo);
          } else {
            setViewingDmRelays([]);
          }
        }

        // 3. Robust Retrieval: Query contact's relays for any missed messages
        if (pubKey && selectedProfile) {
          const allContactRelays = [...new Set([...contactDmRelays, ...generalRelays, ...DEFAULT_RELAYS])];
          console.log(`Syncing missed messages from contact's relays (${allContactRelays.length})...`);
          
          const validMessages = messages.filter(Boolean);
          const latestMsg = validMessages.length > 0 ? validMessages.reduce((prev, curr) => prev.created_at > curr.created_at ? prev : curr) : null;
          const since = latestMsg ? Math.max(latestMsg.created_at + 1, lastSyncTime) : lastSyncTime;

          const missedEvents = await pool.current.querySync(allContactRelays, {
            kinds: [KIND_GIFT_WRAP],
            '#p': [pubKey],
            since,
            limit: 100
          });

          if (missedEvents.length > 0) {
            console.log(`Found ${missedEvents.length} missed events on contact's relays`);
            setPendingEncryptedEvents(prev => {
              const existingIds = new Set(prev.filter(Boolean).map(e => e.id));
              const newEvents = missedEvents.filter(e => e && !existingIds.has(e.id));
              if (newEvents.length === 0) return prev;
              setShowDecryptPrompt(true);
              return [...prev.filter(Boolean), ...newEvents];
            });
          }
        }
      };

      if (existing) {
        setViewingProfile(existing);
        updateRelays(existing);
      } else {
        fetchProfile(selectedProfile).then(p => {
          setViewingProfile(p);
          updateRelays(p);
        });
      }
    } else {
      setViewingProfile(null);
      setViewingRelays([]);
      setViewingDmRelays([]);
      setIsViewingDefaultRelays(false);
    }
  }, [selectedProfile, contacts, searchResults, fetchProfile, fetchRelayInfo]);

  useEffect(() => {
    if (pubKey) {
      loadLocalData();
      fetchProfile(pubKey);
      importExistingData();
      fetchRelayDiscovery();
    }
  }, [pubKey]);

  const fetchRelayDiscovery = async () => {
    try {
      const events = await pool.current.querySync(INDEXER_RELAYS, { kinds: [KIND_RELAY_INFO], limit: 100 });
      const discovery: Record<string, any> = {};
      events.forEach(ev => {
        if (!ev) return;
        const dTag = ev.tags.find(t => t[0] === 'd');
        if (dTag && ev.content) {
          try {
            const data = JSON.parse(ev.content);
            discovery[dTag[1]] = {
              ...data,
              pubkey: ev.pubkey,
              created_at: ev.created_at
            };
          } catch (jsonErr) {
            // Skip malformed events
            console.warn("Skipping malformed NIP-66 event", ev.id, jsonErr);
          }
        }
      });
      setRelayDiscovery(discovery);
    } catch (e) {
      console.error("Failed to fetch NIP-66 relay discovery", e);
    }
  };

  useEffect(() => {
    if (pendingImagePreview) {
      const timer = setTimeout(() => {
        const previewDiv = document.querySelector('.image-preview-container') as HTMLElement;
        previewDiv?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pendingImagePreview]);

  // NIP-42 Relay Authentication
  const authenticatedRelays = useRef<Set<string>>(new Set());

  const handleRelayAuth = useCallback(async (relay: Relay, challenge: string) => {
    if (!pubKey || !loginMethod || authenticatedRelays.current.has(relay.url)) return;
    
    console.log(`Relay ${relay.url} requested AUTH with challenge: ${challenge}`);
    try {
      // NIP-42: The relay tag should match the URL used to connect.
      // Some relays are picky about the trailing slash.
      const normalizedRelayUrl = relay.url.endsWith('/') ? relay.url.slice(0, -1) : relay.url;
      
      await relay.auth(async (evt) => {
        try {
          // We override the relay tag to be more robust (some relays want it without trailing slash)
          const tags = evt.tags.map(t => t[0] === 'relay' ? ['relay', normalizedRelayUrl] : t);
          // Also add the original one just in case
          if (normalizedRelayUrl !== relay.url) {
            tags.push(['relay', relay.url]);
          }
          
          const s = await signEvent({ ...evt, tags, pubkey: pubKey, created_at: Math.floor(Date.now() / 1000) - 2 } as UnsignedEvent);
          if (!s || !s.sig || !s.id) throw new Error("Invalid signed event");
          return s;
        } catch (err) {
          console.error(`AUTH signing failed for ${relay.url}`, err);
          throw err;
        }
      });
      authenticatedRelays.current.add(relay.url);
      console.log(`Successfully authenticated with ${relay.url}`);
      showToast(`Authenticated with ${relay.url.replace('wss://', '')}`, "info");
    } catch (err) {
      console.error(`Failed to sign AUTH event for ${relay.url}`, err);
    }
  }, [pubKey, loginMethod]);

  // Ensure all relays in the pool have the auth handler
  useEffect(() => {
    if (!pubKey || !loginMethod) return;

    const setupRelay = async (url: string) => {
      try {
        const relay = await pool.current.ensureRelay(url);
        relay.onauth = (challenge) => handleRelayAuth(relay, challenge);
      } catch (e) {
        // Ignore connection errors
      }
    };

    const allRelays = [...new Set([
      ...userDmRelays, 
      ...userGeneralRelays, 
      ...viewingDmRelays,
      ...viewingRelays,
      ...DEFAULT_RELAYS, 
      ...INDEXER_RELAYS, 
      ...SEARCH_RELAYS
    ])];
    
    allRelays.forEach(setupRelay);
  }, [pubKey, loginMethod, userDmRelays, userGeneralRelays, viewingDmRelays, viewingRelays, handleRelayAuth]);

  useEffect(() => {
    // No longer scrolling to bottom as newest messages are at the top
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('pam_dm_relays', JSON.stringify(userDmRelays));
  }, [userDmRelays]);

  useEffect(() => {
    localStorage.setItem('pam_general_relays', JSON.stringify(userGeneralRelays));
  }, [userGeneralRelays]);

  useEffect(() => {
    localStorage.setItem('pam_deleted_messages', JSON.stringify(Array.from(deletedMessageIds)));
  }, [deletedMessageIds]);

  useEffect(() => {
    if (!preferredBlossomServer && userBlossomServers.length > 0) {
      setPreferredBlossomServer(userBlossomServers[0]);
      localStorage.setItem('pam_preferred_blossom', userBlossomServers[0]);
    }
  }, [userBlossomServers, preferredBlossomServer]);

  // --- Logic ---
  const loadLocalData = async () => {
    const msgs = await localDb.messages.toArray();
    const sortedMsgs = [...msgs].filter(Boolean).sort((a, b) => a.created_at - b.created_at);
    setMessages(sortedMsgs);
    
    // Rebuild conversations from messages to ensure accuracy
    const conversationMap: Record<string, Conversation> = {};
    
    // Load existing conversations to preserve unreadCount and profile
    const existingConvs = await localDb.conversations.toArray();
    existingConvs.filter(Boolean).forEach(c => {
      conversationMap[c.pubkey] = c;
    });

    // Update with latest messages from messages table
    sortedMsgs.forEach(msg => {
      const otherPk = msg.isSelf ? msg.receiver : msg.sender;
      const existing = conversationMap[otherPk];
      if (!existing || msg.created_at >= existing.lastMessage.created_at) {
        conversationMap[otherPk] = {
          pubkey: otherPk,
          lastMessage: msg,
          unreadCount: existing?.unreadCount || 0,
          profile: existing?.profile
        };
      }
    });

    const convs = Object.values(conversationMap).filter(Boolean);
    if (convs.length > 0) {
      localDb.conversations.bulkPut(convs);
    }
    setConversations(convs.sort((a, b) => b.lastMessage.created_at - a.lastMessage.created_at));

    // Pre-fetch profiles for message partners if missing
    convs.forEach(async (conv) => {
      if (!conv.profile) {
        const p = await fetchProfile(conv.pubkey);
        if (p) {
          setConversations(prev => prev.map(c => c.pubkey === conv.pubkey ? { ...c, profile: p } : c));
          localDb.conversations.update(conv.pubkey, { profile: p });
        }
      }
    });
  };

  useEffect(() => {
    localStorage.setItem('pam_last_sync', lastSyncTime.toString());
  }, [lastSyncTime]);

  const importExistingData = async () => {
    if (!pubKey) return;
    setIsSyncingMessages(true);
    
    try {
      // 1. Fetch User's Relay Lists (KIND 10002 and KIND 10050)
      // Include current relays in search to find updates
      const searchRelays = [...new Set([...INDEXER_RELAYS, ...DEFAULT_RELAYS, ...userGeneralRelays, ...userDmRelays])];
      console.log(`Searching for relay lists on ${searchRelays.length} relays...`);
      
      const relayEvents = await pool.current.querySync(searchRelays, { 
        kinds: [KIND_RELAY_LIST, KIND_DM_RELAYS, 3], 
        authors: [pubKey] 
      });

      let relayEvent = relayEvents.filter(e => e.kind === KIND_RELAY_LIST).sort((a, b) => b.created_at - a.created_at)[0];
      let dmRelayEvent = relayEvents.filter(e => e.kind === KIND_DM_RELAYS).sort((a, b) => b.created_at - a.created_at)[0];
      let contactEvent = relayEvents.filter(e => e.kind === 3).sort((a, b) => b.created_at - a.created_at)[0];

      let discoveredGeneralRelays: string[] = [];
      let discoveredDmRelays: string[] = [];
      
      if (relayEvent) {
        discoveredGeneralRelays = relayEvent.tags.filter(t => t[0] === 'r' && (!t[2] || t[2] === 'write')).map(t => t[1]);
        console.log("Discovered general relays from 10002:", discoveredGeneralRelays);
      }

      // Fallback to Kind 3 relays if Kind 10002 is missing
      if (discoveredGeneralRelays.length === 0 && contactEvent && contactEvent.content) {
        try {
          const relaysObj = JSON.parse(contactEvent.content);
          discoveredGeneralRelays = Object.keys(relaysObj).filter(url => url.startsWith('ws'));
          console.log("Discovered general relays from KIND 3 fallback:", discoveredGeneralRelays);
        } catch (e) {}
      }

      if (discoveredGeneralRelays.length > 0) {
        setUserGeneralRelays(discoveredGeneralRelays);
        localStorage.setItem('pam_general_relays', JSON.stringify(discoveredGeneralRelays));
        
        // If 10050 wasn't found on indexers/defaults, try the discovered general relays
        if (!dmRelayEvent) {
          const extraDmEvents = await pool.current.querySync(discoveredGeneralRelays, { kinds: [KIND_DM_RELAYS], authors: [pubKey] });
          dmRelayEvent = extraDmEvents.sort((a, b) => b.created_at - a.created_at)[0];
        }
      }

      if (dmRelayEvent) {
        discoveredDmRelays = dmRelayEvent.tags.filter(t => t[0] === 'r').map(t => t[1]);
        console.log("Discovered DM relays from 10050:", discoveredDmRelays);
        if (discoveredDmRelays.length > 0) {
          setUserDmRelays(discoveredDmRelays);
          localStorage.setItem('pam_dm_relays', JSON.stringify(discoveredDmRelays));
        }
      } else {
        console.warn("No KIND 10050 DM relay list found for user.");
      }

      // 2. Import Contacts (KIND 3)
      // Use the discovered relays immediately if we found them, otherwise fallback to defaults/saved
      const currentSearchRelays = [...new Set([
        ...INDEXER_RELAYS,
        ...DEFAULT_RELAYS, 
        ...discoveredGeneralRelays, 
        ...discoveredDmRelays,
        ...userGeneralRelays,
        ...userDmRelays
      ])];
      
      console.log(`Fetching contacts from ${currentSearchRelays.length} relays...`);
      if (!contactEvent) {
        contactEvent = await pool.current.get(currentSearchRelays, { kinds: [3], authors: [pubKey] });
      }

      let contactList: Contact[] = [];
      if (contactEvent) {
        contactList = contactEvent.tags
          .filter(t => t[0] === 'p')
          .map(t => ({
            pubkey: t[1],
            petname: t[3] || undefined
          }));
        setContacts(contactList);
      }

      // 3. Robust Relay Gathering: Fetch relay lists for top contacts
      // This helps find messages sent to their relays if we didn't self-wrap
      const topContacts = contactList.slice(0, 15); // Limit to top 15 to avoid overhead
      const contactRelayPromises = topContacts.map(async (c) => {
        const [r10002, r10050] = await Promise.all([
          pool.current.get(currentSearchRelays, { kinds: [KIND_RELAY_LIST], authors: [c.pubkey] }),
          pool.current.get(currentSearchRelays, { kinds: [KIND_DM_RELAYS], authors: [c.pubkey] })
        ]);
        const relays: string[] = [];
        if (r10002) relays.push(...r10002.tags.filter(t => t[0] === 'r').map(t => t[1]));
        if (r10050) relays.push(...r10050.tags.filter(t => t[0] === 'r').map(t => t[1]));
        return relays;
      });

      const discoveredContactRelays = (await Promise.all(contactRelayPromises)).flat();
      
      // 4. Fetch Gift Wraps (KIND 1059) from a broad set of relays
      const validMessages = messages.filter(Boolean);
      const latestMsg = validMessages.length > 0 ? validMessages.reduce((prev, curr) => prev.created_at > curr.created_at ? prev : curr) : null;
      const since = latestMsg ? Math.max(latestMsg.created_at + 1, lastSyncTime) : lastSyncTime;
      
      const messageRelays = [...new Set([
        ...DEFAULT_RELAYS, 
        ...discoveredDmRelays, 
        ...discoveredGeneralRelays,
        ...userDmRelays,
        ...userGeneralRelays,
        ...discoveredContactRelays
      ])].slice(0, 30); // Cap at 30 relays total for performance
      
      console.log(`Syncing messages from ${messageRelays.length} relays...`);
      const events = await pool.current.querySync(messageRelays, { 
        kinds: [KIND_GIFT_WRAP], 
        '#p': [pubKey], 
        since,
        limit: 1000 
      });
      
      if (events.length > 0) {
        console.log(`Found ${events.length} new encrypted events`);
        setPendingEncryptedEvents(events);
        setShowDecryptPrompt(true);
      } else {
        subscribeToMessages();
      }

      // Pre-fetch profiles for follows in background
      contactList.forEach(async (contact) => {
        const p = await fetchProfile(contact.pubkey, false, currentSearchRelays);
        if (p) {
          setContacts(prev => prev.map(c => c.pubkey === contact.pubkey ? { ...c, profile: p } : c));
        }
      });

      // Pre-fetch profiles for message partners in background
      const currentConvs = await localDb.conversations.toArray();
      currentConvs.filter(Boolean).forEach(async (conv) => {
        const p = await fetchProfile(conv.pubkey, false, currentSearchRelays);
        if (p) {
          setConversations(prev => prev.map(c => c.pubkey === conv.pubkey ? { ...c, profile: p } : c));
          localDb.conversations.update(conv.pubkey, { profile: p });
        }
      });

      setLastSyncTime(Math.floor(Date.now() / 1000));
    } catch (err) {
      console.error("Failed to import data:", err);
    } finally {
      setIsSyncingMessages(false);
    }
  };

  const nip44Encrypt = async (otherPk: string, plaintext: string): Promise<string> => {
    if (loginMethod === 'local' && privKey) {
      return nip44.encrypt(plaintext, nip44.getConversationKey(privKey, otherPk));
    }
    if (loginMethod === 'nip07' && window.nostr?.nip44) {
      return window.nostr.nip44.encrypt(otherPk, plaintext);
    }
    if (loginMethod === 'nip46' && bunkerSession) {
      return await nip46Request('nip44_encrypt', [otherPk, plaintext]);
    }
    throw new Error("Encryption failed: No signer or NIP-44 support");
  };

  const nip44Decrypt = async (otherPk: string, ciphertext: string): Promise<string> => {
    let result: any;
    if (loginMethod === 'local' && privKey) {
      result = nip44.decrypt(ciphertext, nip44.getConversationKey(privKey, otherPk));
    } else if (loginMethod === 'nip07' && window.nostr?.nip44) {
      result = await window.nostr.nip44.decrypt(otherPk, ciphertext);
    } else if (loginMethod === 'nip46' && bunkerSession) {
      result = await nip46Request('nip44_decrypt', [otherPk, ciphertext]);
    } else {
      throw new Error("Decryption failed: No signer or NIP-44 support");
    }

    if (result === undefined || result === null || result === "undefined") {
      throw new Error("Decryption returned empty or invalid result");
    }
    return result as string;
  };

  const decryptMessages = async () => {
    if (!pubKey) return;
    setIsDecrypting(true);
    
    for (const event of pendingEncryptedEvents) {
      if (!event || !event.content) continue;
      try {
        const sealStr = await nip44Decrypt(event.pubkey, event.content);
        const seal = JSON.parse(sealStr);
        if (!seal || !seal.pubkey || !seal.content) {
          console.warn("Invalid Seal structure for event", event.id);
          continue;
        }
        if (!verifyEvent(seal)) {
          console.warn("Invalid Seal signature for event", event.id);
          continue;
        }
        const rumorStr = await nip44Decrypt(seal.pubkey, seal.content);
        const rumor = JSON.parse(rumorStr);
        if (!rumor || !rumor.kind) {
          console.warn("Invalid Rumor structure for event", event.id);
          continue;
        }
        
        if (rumor.kind === KIND_DM || rumor.kind === 1222) {
          const receiverTag = rumor.tags.find((t: any) => t[0] === 'p');
          const receiver = receiverTag ? receiverTag[1] : pubKey;
          
          // Parse NIP-92 imeta if present
          const imetaTag = rumor.tags.find((t: any) => t[0] === 'imeta');
          let imetaData: Record<string, string> = {};
          if (imetaTag) {
            imetaTag.slice(1).forEach((part: string) => {
              const [key, ...val] = part.split(' ');
              imetaData[key] = val.join(' ');
            });
          }

          const durationTag = rumor.tags.find((t: any) => t[0] === 'duration');
          const mimeTypeTag = rumor.tags.find((t: any) => t[0] === 'm');

          const msg: Message = {
            id: rumor.id || event.id, // Prefer Rumor ID for deduplication
            sender: rumor.pubkey,
            receiver: receiver,
            content: imetaData.url || rumor.content,
            created_at: rumor.created_at,
            isSelf: rumor.pubkey === pubKey,
            type: (rumor.tags.find((t: any) => t[0] === 't' && t[1] === 'image') || imetaData.m?.startsWith('image/')) ? 'image' : 
                  (rumor.tags.find((t: any) => t[0] === 't' && t[1] === 'voice') || rumor.kind === 1222 || imetaData.m?.startsWith('audio/')) ? 'voice' : 'text',
            duration: imetaData.duration ? parseInt(imetaData.duration) : (durationTag ? parseInt(durationTag[1]) : undefined),
            mimeType: imetaData.m || (mimeTypeTag ? mimeTypeTag[1] : undefined)
          };
          
          setMessages(prev => {
            const filtered = prev.filter(Boolean);
            if (filtered.some(m => m.id === msg.id)) return filtered;
            const next = [...filtered, msg].sort((a, b) => a.created_at - b.created_at);
            localDb.messages.put(msg);
            updateConversation(msg);
            return next;
          });
        }
      } catch (e: any) {
        if (e.message?.includes('invalid MAC') || e.message?.includes('empty or invalid result')) {
          console.warn("Decryption failed for event", event.id, "-", e.message, "- likely not for this key or corrupted.");
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
    if (!pubKey) return;
    // Listen on all user's relays (DM + General) to be robust
    const relays = [...new Set([...userDmRelays, ...userGeneralRelays, ...INDEXER_RELAYS, ...DEFAULT_RELAYS])].slice(0, 30);
    
    console.log(`Subscribing to messages on ${relays.length} relays...`);
    const sub = pool.current.subscribeMany(relays, [
      { kinds: [KIND_GIFT_WRAP], '#p': [pubKey] }
    ], {
      onevent: async (event) => {
        if (!event || !event.content) return;
        try {
          const sealStr = await nip44Decrypt(event.pubkey, event.content);
          const seal = JSON.parse(sealStr);
          if (!seal || !seal.pubkey || !seal.content) {
            console.warn("Invalid Seal structure for event", event.id);
            return;
          }
          if (!verifyEvent(seal)) {
            console.warn("Invalid Seal signature for event", event.id);
            return;
          }
          const rumorStr = await nip44Decrypt(seal.pubkey, seal.content);
          const rumor = JSON.parse(rumorStr);
          if (!rumor || !rumor.kind) {
            console.warn("Invalid Rumor structure for event", event.id);
            return;
          }
          if (rumor.kind === KIND_DM || rumor.kind === 1222) {
            const receiverTag = rumor.tags.find((t: any) => t[0] === 'p');
            const receiver = receiverTag ? receiverTag[1] : pubKey;

            const durationTag = rumor.tags.find((t: any) => t[0] === 'duration');
            const mimeTypeTag = rumor.tags.find((t: any) => t[0] === 'm');

            const msg: Message = {
              id: rumor.id || event.id, // Prefer Rumor ID for deduplication
              sender: rumor.pubkey,
              receiver: receiver,
              content: rumor.content,
              created_at: rumor.created_at,
              isSelf: rumor.pubkey === pubKey,
              type: rumor.tags.find((t: any) => t[0] === 't' && t[1] === 'image') ? 'image' : 
                    (rumor.tags.find((t: any) => t[0] === 't' && t[1] === 'voice') || rumor.kind === 1222) ? 'voice' : 'text',
              duration: durationTag ? parseInt(durationTag[1]) : undefined,
              mimeType: mimeTypeTag ? mimeTypeTag[1] : undefined
            };

            if (notificationsEnabled && !msg.isSelf && activeChat !== msg.sender) {
              const profile = conversations.find(c => c && c.pubkey === msg.sender)?.profile;
              new Notification(profile?.name || 'New Message', {
                body: msg.content,
                icon: profile?.picture || '/pam-logo.png'
              });
            }

            setMessages(prev => {
              const filtered = prev.filter(Boolean);
              if (filtered.some(m => m.id === msg.id)) return filtered;
              const next = [...filtered, msg].sort((a, b) => a.created_at - b.created_at);
              localDb.messages.put(msg);
              updateConversation(msg);
              return next;
            });
          }
        } catch (e: any) {
          if (e.message?.includes('invalid MAC') || e.message?.includes('empty or invalid result')) {
            console.warn("Decryption failed for event", event.id, "-", e.message, "- likely not for this key or corrupted.");
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
      const filtered = prev.filter(Boolean);
      const existing = filtered.find(c => c.pubkey === otherPk);
      const isNewer = !existing || msg.created_at >= existing.lastMessage.created_at;
      const updated: Conversation = {
        pubkey: otherPk,
        lastMessage: isNewer ? msg : existing.lastMessage,
        unreadCount: (existing?.unreadCount || 0) + (msg.isSelf || activeChat === otherPk ? 0 : 1),
        profile: existing?.profile
      };
      localDb.conversations.put(updated);
      const next = [updated, ...filtered.filter(c => c.pubkey !== otherPk)];
      if (!updated.profile) fetchProfile(otherPk).then(p => {
        if (p) {
          setConversations(curr => curr.filter(Boolean).map(c => c.pubkey === otherPk ? { ...c, profile: p } : c));
          localDb.conversations.update(otherPk, { profile: p });
        }
      });
      return next;
    });
  };

  const signEvent = async (template: UnsignedEvent): Promise<VerifiedEvent> => {
    if (loginMethod === 'local' && privKey) return finalizeEvent(template, privKey);
    if (loginMethod === 'nip07' && window.nostr) {
      const signed = await window.nostr.signEvent(template);
      if (!signed) throw new Error("User cancelled signing");
      if (!signed.id) signed.id = getEventHash(signed);
      return signed as VerifiedEvent;
    }
    if (loginMethod === 'nip46' && bunkerSession) {
      const response = await nip46Request('sign_event', [JSON.stringify(template)]);
      try {
        const signed = typeof response === 'string' ? JSON.parse(response) : response;
        if (!signed || !signed.sig) {
          throw new Error("Bunker returned an unsigned or invalid event");
        }
        if (!signed.id) {
          signed.id = getEventHash(signed);
        }
        return signed as VerifiedEvent;
      } catch (e) {
        console.error("Failed to parse signed event from Bunker", e, response);
        throw new Error("Bunker returned an invalid signed event format");
      }
    }
    if (loginMethod === 'nip55') {
      // NIP-55 Android Signer intent
      const eventJson = JSON.stringify(template);
      const intentUrl = `intent:#Intent;action=com.nostr.signer.SIGN_EVENT;S.event=${encodeURIComponent(eventJson)};S.pubKey=${pubKey};end`;
      window.location.href = intentUrl;
      // This is tricky on web as it's a redirect. Real NIP-55 on web usually relies on a bridge.
      // For now we'll throw as we can't wait for the result easily without a bridge.
      throw new Error("NIP-55 requires a compatible Android Nostr browser or bridge.");
    }
    throw new Error("No signer");
  };

  const nip46Request = async (method: string, params: string[]): Promise<string> => {
    if (!bunkerSession) throw new Error("No bunker session");
    const { remotePubkey, localPrivkey, relay } = bunkerSession;
    const id = Math.random().toString(36).substring(7);
    const request = { id, method, params };
    const encrypted = nip44.encrypt(JSON.stringify(request), nip44.getConversationKey(localPrivkey, remotePubkey));
    
    const event: UnsignedEvent = {
      kind: 24133,
      pubkey: getPublicKey(localPrivkey),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', remotePubkey]],
      content: encrypted
    };
    
    const signed = finalizeEvent(event, localPrivkey);
    await pool.current.publish([relay], signed);
    
    return new Promise((resolve, reject) => {
      const sub = pool.current.subscribeMany([relay], [
        { kinds: [24133], authors: [remotePubkey], '#p': [getPublicKey(localPrivkey)] }
      ], {
        onevent: (ev) => {
          if (!ev) return;
          try {
            const decrypted = nip44.decrypt(ev.content, nip44.getConversationKey(localPrivkey, remotePubkey));
            const response = JSON.parse(decrypted);
            if (response && response.id === id) {
              sub.close();
              if (response.error) reject(new Error(response.error));
              else if (response.result === undefined || response.result === null) reject(new Error("NIP-46 response result is empty"));
              else resolve(response.result);
            }
          } catch (e) {}
        }
      });
      setTimeout(() => { sub.close(); reject(new Error("Request timed out")); }, 10000);
    });
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

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const uploadToBlossom = async (blob: Blob): Promise<string> => {
    if (blob.size === 0) {
      console.error("Attempted to upload an empty blob to Blossom");
      throw new Error("Cannot upload empty file. Recording may have failed.");
    }
    
    // Only require pubKey here, privKey is handled by signEvent based on loginMethod
    if (!pubKey) throw new Error("Public key missing. Please log in first.");
    if (loginMethod === 'local' && !privKey) throw new Error("Private key missing for local login.");
    
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    const getExtension = (mimeType: string) => {
      const m = mimeType.toLowerCase();
      if (m.includes('mp4')) return '.m4a';
      if (m.includes('webm')) return '.webm';
      if (m.includes('mpeg') || m.includes('mp3')) return '.mp3';
      if (m.includes('ogg')) return '.ogg';
      if (m.includes('wav')) return '.wav';
      if (m.includes('aac')) return '.aac';
      if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
      if (m.includes('png')) return '.png';
      if (m.includes('gif')) return '.gif';
      return '';
    };

    const ext = getExtension(blob.type || '');
    
    const normalize = (s: string) => s.endsWith('/') ? s.slice(0, -1) : s;
    let servers = [...new Set([...userBlossomServers.map(normalize)])];
    if (servers.length === 0) {
      servers = [...DEFAULT_BLOSSOM_SERVERS.map(normalize)];
    }
    if (preferredBlossomServer) {
      const pref = normalize(preferredBlossomServer);
      // Ensure the preferred server is at the very front
      servers = [pref, ...servers.filter(s => s !== pref)];
    }
    
    setUploadProgress(0);
    
    for (const normalizedServer of servers) {
      try {
        console.log(`Blossom Upload: Attempting ${normalizedServer}...`);
        // 1. Check if blob already exists
        try {
          // Try both with and without extension
          const checkUrls = [`${normalizedServer}/${hashHex}`, `${normalizedServer}/${hashHex}${ext}`].filter(Boolean);
          for (const checkUrl of checkUrls) {
            const checkResponse = await fetch(checkUrl, { method: 'HEAD' });
            if (checkResponse.ok) {
              console.log(`Blossom Upload: Blob already exists on ${normalizedServer} at ${checkUrl}`);
              setUploadProgress(100);
              return checkUrl;
            }
          }
        } catch (e) {
          console.log(`Blossom Upload: HEAD check failed for ${normalizedServer}, proceeding with upload attempt`);
        }

        console.log(`Blossom Upload: Attempting upload to ${normalizedServer}...`);
        
        // Notify user we are signing
        setUploadProgress(0);
        
        // NIP-126 standard is PUT /
        // Some servers are picky about the trailing slash in the 'u' tag
        const uploadUrl = normalizedServer.endsWith('/') ? normalizedServer : `${normalizedServer}/`;
        
        const authEvent: UnsignedEvent = {
          kind: 24242,
          pubkey: pubKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['t', 'upload'],
            ['x', hashHex],
            ['size', blob.size.toString()],
            ['expiration', (Math.floor(Date.now() / 1000) + 3600).toString()],
            ['u', uploadUrl]
          ],
          content: `Upload ${blob.type || 'file'} to Blossom`
        };
        
        const signedAuth = await signEvent(authEvent);
        console.log(`Blossom Upload: Event signed, starting upload to ${uploadUrl}...`);
        
        // Use UTF-8 safe btoa for the JSON string. Nostr events are ASCII-safe JSON but content might have emojis.
        const authHeader = btoa(unescape(encodeURIComponent(JSON.stringify(signedAuth))));
        
        // Clean content type (remove codecs which can confuse some servers)
        const contentType = blob.type.split(';')[0] || 'application/octet-stream';

        // Try fetch first for better CORS handling on some servers
        try {
          const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Authorization': `Nostr ${authHeader}`,
              'Content-Type': contentType
            },
            body: blob,
            mode: 'cors',
            credentials: 'omit'
          });

          if (response.ok) {
            console.log(`Blossom Upload: Success on ${normalizedServer} via PUT /`);
            setUploadProgress(100);
            return `${normalizedServer}/${hashHex}${ext}`;
          } else if (response.status === 404 || response.status === 405) {
            console.warn(`Blossom Upload: Server ${normalizedServer} returned ${response.status} on root PUT, trying PUT /[hash]...`);
            const hashUrl = `${normalizedServer.endsWith('/') ? normalizedServer : `${normalizedServer}/`}${hashHex}`;
            
            const newAuthEvent: UnsignedEvent = {
              ...authEvent,
              tags: authEvent.tags.map(t => t[0] === 'u' ? ['u', hashUrl] : t)
            };
            const newSignedAuth = await signEvent(newAuthEvent);
            const newAuthHeader = btoa(unescape(encodeURIComponent(JSON.stringify(newSignedAuth))));
            
            const hashResponse = await fetch(hashUrl, {
              method: 'PUT',
              headers: {
                'Authorization': `Nostr ${newAuthHeader}`,
                'Content-Type': contentType
              },
              body: blob,
              mode: 'cors',
              credentials: 'omit'
            });

            if (hashResponse.ok) {
              console.log(`Blossom Upload: Success on ${normalizedServer} via PUT /[hash]`);
              setUploadProgress(100);
              return `${normalizedServer}/${hashHex}${ext}`;
            } else {
              throw new Error(`Upload failed with status ${hashResponse.status}`);
            }
          } else {
            throw new Error(`Upload failed with status ${response.status}`);
          }
        } catch (fetchErr: any) {
          console.error(`Blossom Upload: Fetch error on ${normalizedServer}:`, fetchErr);
          throw fetchErr;
        }
      } catch (err) {
        console.error(`Blossom Upload: Failed to process ${normalizedServer}:`, err);
      }
    }
    
    showToast("Failed to upload to any Blossom server", "error");
    throw new Error("Upload failed. Check your network or try adding a different media server in Settings.");
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setPendingMessages(prev => {
        const next = { ...prev };
        let changed = false;
        Object.keys(next).forEach(id => {
          if (next[id].timeLeft > 0) {
            next[id] = { ...next[id], timeLeft: next[id].timeLeft - 1 };
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const cancelPendingMessage = (id: string) => {
    setPendingMessages(prev => {
      const msg = prev[id];
      if (msg) {
        clearTimeout(msg.timeoutId);
        if (msg.type === 'text') setNewMessage(msg.content);
      }
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const performSendMessage = async (content: string, type: MessageType = 'text', duration?: number, mimeType?: string) => {
    if (!activeChat || !pubKey || (!privKey && loginMethod === 'local')) return;
    const text = content.trim();
    if (!text && type === 'text') return;
    setIsMining(true);
    const tempId = Math.random().toString(36).substring(7);
    const msg: Message = { 
      id: tempId, 
      sender: pubKey, 
      receiver: activeChat, 
      content: text, 
      created_at: Math.floor(Date.now() / 1000), 
      isSelf: true, 
      type,
      duration,
      mimeType
    };
    
    // Check for NIP-44 size limit (65535 bytes)
    if (text.length > 60000) {
      alert("Message too large. Please send a shorter text.");
      setIsMining(false);
      return;
    }

    setMessages(prev => [...prev, msg]);
    try {
      const rumorTemplate: UnsignedEvent = { 
        kind: KIND_DM, 
        pubkey: pubKey, 
        created_at: msg.created_at, 
        tags: [['p', activeChat]], 
        content: text 
      };
      
      // NIP-92 / NIP-94 style metadata for media
      if (type === 'image' || type === 'voice') {
        const imeta = ['imeta', `url ${text}`];
        if (mimeType) imeta.push(`m ${mimeType}`);
        if (duration) imeta.push(`duration ${duration}`);
        rumorTemplate.tags.push(imeta);
        
        // Legacy tags for compatibility
        rumorTemplate.tags.push(['t', type]);
        if (mimeType) rumorTemplate.tags.push(['m', mimeType]);
        if (duration) rumorTemplate.tags.push(['duration', duration.toString()]);
      }

      const rumor = { ...rumorTemplate, id: getEventHash(rumorTemplate) };
      
      // 1. Create Seals (KIND 13)
      const sealForReceiverTemplate: UnsignedEvent = {
        kind: 13,
        pubkey: pubKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: await nip44Encrypt(activeChat, JSON.stringify(rumor))
      };
      const signedSealForReceiver = await signEvent(sealForReceiverTemplate);

      // 2. Create Gift Wraps (KIND 1059)
      const ephemeralPriv = generateSecretKey();
      const ephemeralPub = getPublicKey(ephemeralPriv);
      const wrapCreatedAt = Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 60);

      const wrapForReceiverTemplate: UnsignedEvent = {
        kind: KIND_GIFT_WRAP,
        pubkey: ephemeralPub,
        created_at: wrapCreatedAt,
        tags: [['p', activeChat]],
        content: nip44.encrypt(JSON.stringify(signedSealForReceiver), nip44.getConversationKey(ephemeralPriv, activeChat))
      };
      const signedWrapForReceiver = finalizeEvent(wrapForReceiverTemplate, ephemeralPriv);

      let signedWrapForSelf: Event | null = null;
      if (activeChat !== pubKey) {
        const sealForSelfTemplate: UnsignedEvent = {
          kind: 13,
          pubkey: pubKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: await nip44Encrypt(pubKey, JSON.stringify(rumor))
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
      
      let finalWrapForReceiver = signedWrapForReceiver;
      if (powDifficulty > 0) {
        let nonce = 0;
        const baseTags = [...wrapForReceiverTemplate.tags];
        while (true) {
          const tags = [...baseTags, ['nonce', nonce.toString(), powDifficulty.toString()]];
          const id = getEventHash({ ...wrapForReceiverTemplate, tags });
          if (validateDifficulty(id, powDifficulty)) {
            finalWrapForReceiver = finalizeEvent({ ...wrapForReceiverTemplate, tags }, ephemeralPriv);
            break;
          }
          nonce++;
          if (nonce % 1000 === 0) await new Promise(r => setTimeout(r, 0));
        }
      }

      const relays = [...new Set([...userDmRelays, ...DEFAULT_RELAYS, ...viewingRelays])];
      const publishPromises = [publishWithTimeout(pool.current, relays, finalWrapForReceiver)];
      if (signedWrapForSelf) {
        publishPromises.push(publishWithTimeout(pool.current, relays, signedWrapForSelf));
      }
      await Promise.allSettled(publishPromises);
      
      if (rumor && rumor.id) {
        setMessages(prev => prev.filter(Boolean).map(m => m.id === tempId ? { ...m, id: rumor.id } : m));
        localDb.messages.put({ ...msg, id: rumor.id });
        updateConversation({ ...msg, id: rumor.id });
      }
    } catch (err) {
      console.error("Send failed", err);
      showToast("Failed to send message: " + (err instanceof Error ? err.message : String(err)), "error");
      setMessages(prev => prev.filter(m => m && m.id !== tempId));
    } finally {
      setIsMining(false);
    }
  };

  const sendMessage = async (content = newMessage, type: MessageType = 'text', duration?: number, mimeType?: string) => {
    if (!activeChat || !pubKey) return;
    if (loginMethod === 'local' && !privKey) return;
    const text = content.trim();
    if (!text && type === 'text') return;

    if (!sendDelayEnabled) {
      setNewMessage('');
      return performSendMessage(text, type, duration, mimeType);
    }

    const id = Math.random().toString(36).substring(7);
    const timeoutId = window.setTimeout(() => {
      performSendMessage(text, type, duration, mimeType);
      setPendingMessages(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 10000);

    setPendingMessages(prev => ({
      ...prev,
      [id]: { timeoutId, timeLeft: 10, content: text, type, duration, mimeType }
    }));

    setNewMessage('');
  };

  const loginLocal = (key: Uint8Array) => {
    const pk = getPublicKey(key);
    setPrivKey(key); setPubKey(pk); setLoginMethod('local');
    localStorage.setItem('pam_login_method', 'local');
    localStorage.setItem('pam_privkey', key.toString());
  };

  useEffect(() => {
    userDmRelays.forEach(fetchRelayInfo);
    userGeneralRelays.forEach(fetchRelayInfo);
  }, [userDmRelays, userGeneralRelays, fetchRelayInfo]);

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
    showToast("DM Relay added", "success");
    fetchRelayInfo(url);
  };

  const removeRelay = (url: string) => {
    const next = userDmRelays.filter(r => r !== url);
    setUserDmRelays(next);
    localStorage.setItem('pam_dm_relays', JSON.stringify(next));
    showToast("DM Relay removed", "success");
  };

  const addGeneralRelay = async () => {
    if (!newRelayUrl.trim()) return;
    let url = newRelayUrl.trim();
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      url = 'wss://' + url;
    }
    if (userGeneralRelays.includes(url)) {
      showToast("Relay already added", "info");
      return;
    }
    const next = [...userGeneralRelays, url];
    setUserGeneralRelays(next);
    localStorage.setItem('pam_general_relays', JSON.stringify(next));
    setNewRelayUrl('');
    showToast("General Relay added", "success");
    fetchRelayInfo(url);
  };

  const removeGeneralRelay = (url: string) => {
    const next = userGeneralRelays.filter(r => r !== url);
    setUserGeneralRelays(next);
    localStorage.setItem('pam_general_relays', JSON.stringify(next));
    showToast("General Relay removed", "success");
  };

  const addBlossomServer = () => {
    if (!newBlossomUrl.trim()) return;
    let url = newBlossomUrl.trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    if (url.endsWith('/')) url = url.slice(0, -1);
    
    if (userBlossomServers.includes(url)) {
      showToast("Server already added", "info");
      return;
    }
    
    const updated = [...userBlossomServers, url];
    setUserBlossomServers(updated);
    localStorage.setItem('pam_blossom_servers', JSON.stringify(updated));
    setNewBlossomUrl('');
    showToast("Blossom server added locally", "success");
  };

  const removeBlossomServer = (url: string) => {
    const updated = userBlossomServers.filter(s => s !== url);
    setUserBlossomServers(updated);
    localStorage.setItem('pam_blossom_servers', JSON.stringify(updated));
    showToast("Blossom server removed locally", "success");
  };

  const startRecording = async () => {
    if (!preferredBlossomServer) {
      showToast("Please select a Media Server first", "info");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stream.getAudioTracks().length === 0) {
        throw new Error("No audio tracks found in stream");
      }
      
      const mimeTypes = [
        'audio/mp4',
        'audio/aac',
        'audio/mpeg',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/webm;codecs=opus',
        'audio/webm'
      ];
      const supportedType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
      
      console.log(`Starting recording with mimeType: ${supportedType || 'default'}`);
      const options: MediaRecorderOptions = {
        audioBitsPerSecond: 64000 // Lower bitrate for better compatibility
      };
      if (supportedType) options.mimeType = supportedType;

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
          console.log(`Data available: ${e.data.size} bytes. Total chunks: ${chunks.length}`);
        }
      };

      mediaRecorder.onstart = () => {
        setIsRecording(true);
        setRecordingDuration(0);
        recordingIntervalRef.current = window.setInterval(() => {
          setRecordingDuration(prev => {
            if (prev >= 120) {
              stopRecording();
              return prev;
            }
            return prev + 1;
          });
        }, 1000);
      };

      mediaRecorder.onstop = () => {
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
          recordingIntervalRef.current = null;
        }
        setIsRecording(false);
        const finalType = mediaRecorder.mimeType || supportedType || 'audio/mp4';
        const blob = new Blob(chunks, { type: finalType });
        console.log(`Recording stopped. Final Type: ${finalType}, Total chunks: ${chunks.length}, Blob size: ${blob.size} bytes`);
        
        if (blob.size === 0) {
          console.error("CRITICAL: Recording resulted in an empty blob!");
          showToast("Recording failed: No audio data captured.", "error");
          setAudioBlob(null);
          setAudioUrl(null);
        } else {
          setAudioBlob(blob);
          setAudioUrl(URL.createObjectURL(blob));
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(100); // Smaller timeslice for better reliability
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
    if (uploadXhrRef.current) {
      uploadXhrRef.current.abort();
      uploadXhrRef.current = null;
    }
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setRecordingDuration(0);
    setIsUploading(false);
    setUploadProgress(0);
  };

  const discardImage = () => {
    if (uploadXhrRef.current) {
      uploadXhrRef.current.abort();
      uploadXhrRef.current = null;
    }
    setPendingImage(null);
    setPendingImagePreview(null);
    setIsUploading(false);
    setUploadProgress(0);
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
      setIsSyncingMessages(true);
      // Parse bunker URI: bunker://<pubkey>@<relay>?secret=<secret>
      const url = new URL(bunkerUri.replace('bunker://', 'https://'));
      const remotePubkey = url.username;
      const relay = url.hostname;
      const secret = url.searchParams.get('secret') || '';
      
      if (!remotePubkey || !relay) throw new Error("Invalid Bunker URI");
      
      const localPrivkey = generateSecretKey();
      const session = { remotePubkey, localPrivkey, relay };
      setBunkerSession(session);
      
      // Send connect request
      const id = Math.random().toString(36).substring(7);
      const request = { id, method: 'connect', params: [getPublicKey(localPrivkey), secret] };
      const encrypted = nip44.encrypt(JSON.stringify(request), nip44.getConversationKey(localPrivkey, remotePubkey));
      
      const event: UnsignedEvent = {
        kind: 24133,
        pubkey: getPublicKey(localPrivkey),
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', remotePubkey]],
        content: encrypted
      };
      
      const signed = finalizeEvent(event, localPrivkey);
      await pool.current.publish([relay], signed);
      
      // Wait for response
      const response = await new Promise<string>((resolve, reject) => {
        const sub = pool.current.subscribeMany([relay], [
          { kinds: [24133], authors: [remotePubkey], '#p': [getPublicKey(localPrivkey)] }
        ], {
          onevent: (ev) => {
            try {
              const decrypted = nip44.decrypt(ev.content, nip44.getConversationKey(localPrivkey, remotePubkey));
              const resp = JSON.parse(decrypted);
              if (resp && resp.id === id) {
                sub.close();
                if (resp.error) reject(new Error(resp.error));
                else resolve(resp.result);
              }
            } catch (e) {}
          }
        });
        setTimeout(() => { sub.close(); reject(new Error("Connect timed out")); }, 15000);
      });

      if (response === 'ack' || response === remotePubkey) {
        setPubKey(remotePubkey);
        setLoginMethod('nip46');
        localStorage.setItem('pam_login_method', 'nip46');
        localStorage.setItem('pam_bunker_session', JSON.stringify({ 
          remotePubkey, 
          localPrivkey: bytesToHex(localPrivkey), 
          relay 
        }));
        setShowBunkerInput(false);
        showToast("Connected to Bunker", "success");
      }
    } catch (err: any) {
      console.error("Bunker login failed", err);
      alert(`Bunker login failed: ${err.message}`);
      setBunkerSession(null);
    } finally {
      setIsSyncingMessages(false);
    }
  };

  useEffect(() => {
    localStorage.setItem('pam_sidebar_tab', sidebarTab);
  }, [sidebarTab]);

  useEffect(() => {
    localStorage.setItem('pam_settings_tab', settingsTab);
  }, [settingsTab]);

  const logout = () => {
    const keysToKeep = [
      'pam_theme',
      'pam_font_size',
      'pam_font_family',
      'pam_send_delay',
      'pam_notifications',
      'pam_sidebar_tab',
      'pam_settings_tab'
    ];
    
    const savedSettings: Record<string, string> = {};
    keysToKeep.forEach(key => {
      const val = localStorage.getItem(key);
      if (val) savedSettings[key] = val;
    });

    localStorage.clear();
    
    Object.entries(savedSettings).forEach(([key, val]) => {
      localStorage.setItem(key, val);
    });

    localDb.delete().then(() => window.location.reload());
  };

  const togglePriority = (targetPk: string) => {
    const isPriority = priorityPubkeys.includes(targetPk);
    const newPriority = isPriority 
      ? priorityPubkeys.filter(pk => pk !== targetPk)
      : [...priorityPubkeys, targetPk];
    
    setPriorityPubkeys(newPriority);
    localStorage.setItem('pam_priority_pubkeys', JSON.stringify(newPriority));
    
    setSearchResults(prev => prev.map(res => 
      res.pubkey === targetPk ? { ...res, isPriority: !isPriority } : res
    ));
  };

  const updatePetname = async (pk: string, petname: string) => {
    if (!pubKey) return;
    
    // If not following, this will follow them with a petname
    const isFollowing = contacts.filter(Boolean).some(c => c.pubkey === pk);
    let newContacts: Contact[];
    
    if (isFollowing) {
      newContacts = contacts.filter(Boolean).map(c => c.pubkey === pk ? { ...c, petname } : c);
    } else {
      const p = await fetchProfile(pk);
      newContacts = [...contacts.filter(Boolean), { pubkey: pk, profile: p || undefined, petname }];
    }
    
    setContacts(newContacts);
    showToast("Petname updated", "success");
    
    // NIP-02: ["p", <pubkey>, <relay-url>, <petname>]
    const tags = newContacts.map(c => ['p', c.pubkey, '', c.petname || '']);
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
      console.error('Failed to update petname:', err);
    }
  };

  const toggleFollow = async (pk: string) => {
    if (!pubKey) return;
    const isFollowing = contacts.filter(Boolean).some(c => c.pubkey === pk);
    let newContacts: Contact[];
    
    if (isFollowing) {
      newContacts = contacts.filter(Boolean).filter(c => c.pubkey !== pk);
    } else {
      const p = await fetchProfile(pk);
      newContacts = [...contacts.filter(Boolean), { pubkey: pk, profile: p || undefined }];
    }
    
    setContacts(newContacts);
    setSearchResults(prev => prev.map(res => 
      res.pubkey === pk ? { ...res, isWoT: !isFollowing } : res
    ));
    showToast(isFollowing ? "Unfollowed" : "Followed", "success");
    
    const tags = newContacts.map(c => ['p', c.pubkey, '', c.petname || '']);
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

  const submitTrustScore = async () => {
    if (!selectedProfile || !trustScoreContext.trim()) return;
    
    const event: UnsignedEvent = {
      kind: KIND_REVIEW,
      pubkey: pubKey!,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', selectedProfile],
        ['l', trustScoreValue.toString(), 'trust'],
        ['rating', trustScoreValue.toString()] // Keep rating for compatibility
      ],
      content: trustScoreContext.trim()
    };
    
    const signed = await signEvent(event);
    if (signed) {
      const relays = userDmRelays.length > 0 ? userDmRelays : DEFAULT_RELAYS;
      await publishWithTimeout(pool.current, relays, signed);
      showToast("Trust score published", "success");
      setShowTrustScoreForm(false);
      setTrustScoreContext('');
      setTrustScoreValue(1.0);
      // Refresh scores
      fetchTrustScores(selectedProfile).then(setViewingTrustScores);
    }
  };

  const clearConversation = async (pk: string) => {
    try {
      // 1. Find all messages sent by the user in this conversation
      const myMessages = await localDb.messages
        .where('sender').equals(pubKey!)
        .and(m => m.receiver === pk)
        .toArray();
      
      const eventIdsToDelete = myMessages.filter(m => m && m.id).map(m => m.id);
      
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
      
      setMessages(prev => prev.filter(m => m && m.sender !== pk && m.receiver !== pk));
      setConversations(prev => prev.filter(c => c && c.pubkey !== pk));
      
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
      
      setMessages(prev => prev.filter(m => m && m.sender !== pk && m.receiver !== pk));
      setConversations(prev => prev.filter(c => c && c.pubkey !== pk));
      
      if (activeChat === pk) setActiveChat(null);
      setSelectedProfile(null);
      setDeleteConfirmPk(null);
      showToast("Conversation deleted", "success");
    } catch (err) {
      console.error("Failed to delete conversation", err);
    }
  };

  const getInboxRelaysOfPartners = async () => {
    const pks = conversations.filter(Boolean).map(c => c.pubkey);
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

  const searchOnRelays = async (relays: string[], query: string, limit = 10): Promise<Contact[]> => {
    try {
      // NIP-50 search filter
      const events = await pool.current.querySync(relays, { 
        kinds: [0], 
        search: query, 
        limit 
      });
      
      const results: Contact[] = [];
      const seen = new Set<string>();

      events.forEach(ev => {
        if (seen.has(ev.pubkey)) return;
        seen.add(ev.pubkey);
        try {
          const profile = JSON.parse(ev.content);
          results.push({ 
            pubkey: ev.pubkey, 
            profile,
            isWoT: wotPubkeys.includes(ev.pubkey),
            followedBy: wotFollowMap[ev.pubkey],
            isPriority: priorityPubkeys.includes(ev.pubkey)
          });
        } catch {
          results.push({ 
            pubkey: ev.pubkey,
            isWoT: wotPubkeys.includes(ev.pubkey),
            followedBy: wotFollowMap[ev.pubkey],
            isPriority: priorityPubkeys.includes(ev.pubkey)
          });
        }
      });
      return results;
    } catch (e) {
      console.warn("Search filter failed or not supported", e);
      return [];
    }
  };

  const getWoTPubkeys = async (signal?: AbortSignal) => {
    const directFollows = contacts.filter(Boolean).map(c => c.pubkey);
    if (directFollows.length === 0 || signal?.aborted) return { secondDegree: [], followMap: {} };
    
    try {
      const searchRelays = userDmRelays.length > 0 ? [...new Set([...DEFAULT_RELAYS, ...userDmRelays])] : DEFAULT_RELAYS;
      // Fetch Kind 3 (Contact Lists) for direct follows
      const wotEvents = await Promise.race([
        pool.current.querySync(searchRelays, { 
          kinds: [3], 
          authors: directFollows 
        }),
        new Promise<Event[]>((_, reject) => {
          const timeoutId = setTimeout(() => reject(new Error('WoT fetch timeout')), 8000);
          signal?.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            reject(new Error('AbortError'));
          });
        })
      ]);
      
      if (signal?.aborted) return { secondDegree: [], followMap: {} };
      
      const secondDegree = new Set<string>();
      const followMap: Record<string, string[]> = {};
      
      wotEvents.forEach(ev => {
        ev.tags.forEach(tag => {
          if (tag[0] === 'p') {
            const targetPk = tag[1];
            secondDegree.add(targetPk);
            if (!followMap[targetPk]) followMap[targetPk] = [];
            if (!followMap[targetPk].includes(ev.pubkey)) followMap[targetPk].push(ev.pubkey);
          }
        });
      });
      
      // Remove direct follows and self
      directFollows.forEach(pk => {
        secondDegree.delete(pk);
      });
      if (pubKey) {
        secondDegree.delete(pubKey);
      }
      
      return { 
        secondDegree: Array.from(secondDegree), 
        followMap
      };
    } catch (e) {
      if (e instanceof Error && e.message === 'AbortError') return { secondDegree: [], followMap: {} };
      console.error("Failed to fetch WoT pubkeys", e);
      return { secondDegree: [], followMap: {} };
    }
  };

  const scoreProfile = (contact: Contact): number => {
    let score = 0;
    
    // NIP-02 Petname is the strongest local signal
    if (contact.petname) score += 500;

    // Direct follow is a very strong signal
    const isFollowed = contacts.filter(Boolean).some(c => c.pubkey === contact.pubkey);
    if (isFollowed) score += 300;

    if (!contact.profile) return score - 50;
    
    // NIP-05 verification is a strong signal
    if (contact.profile.nip05) {
      score += 100;
      if (contact.profile.nip05.endsWith('@npub.world') || contact.profile.nip05.endsWith('@nostr.com') || contact.profile.nip05.endsWith('@primal.net')) {
        score += 50; // Prioritize well-known providers
      }
    }
    
    // Metadata completeness
    if (contact.profile.picture) score += 20;
    if (contact.profile.display_name || contact.profile.name) score += 20;
    if (contact.profile.about) score += 10;

    // Web of Trust signals
    if (contact.isWoT) score += 50;
    if (contact.followedBy && contact.followedBy.length > 0) {
      score += Math.min(contact.followedBy.length * 15, 150); // Cap at 150
    }

    // NIP-85 Trust Scores signal
    if (contact.trustScores && contact.trustScores.length > 0) {
      score += contact.trustScores.length * 20;
      const avgScore = contact.trustScores.reduce((acc, r) => acc + r.score, 0) / contact.trustScores.length;
      if (avgScore > 0.8) score += 100;
      else if (avgScore > 0.5) score += 50;
    }
    
    return score;
  };

  const cancelSearch = () => {
    if (searchAbortController) {
      searchAbortController.abort();
      setSearchAbortController(null);
    }
    setIsSearching(false);
    showToast("Search cancelled", "info");
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    // Abort previous search if any
    if (searchAbortController) {
      searchAbortController.abort();
    }
    
    const controller = new AbortController();
    setSearchAbortController(controller);
    setIsSearching(true);
    setSearchResults([]);
    
    const seenPubkeys = new Set<string>();

    const updateResults = (newContacts: Contact[]) => {
      setSearchResults(prev => {
        const combined = [...prev];
        newContacts.forEach(c => {
          if (!seenPubkeys.has(c.pubkey)) {
            combined.push(c);
            seenPubkeys.add(c.pubkey);
          } else {
            // Update existing result if it has more info (like trust scores or WoT info)
            const idx = combined.findIndex(item => item.pubkey === c.pubkey);
            if (idx !== -1) {
              combined[idx] = { ...combined[idx], ...c };
            }
          }
        });
        return combined.sort((a, b) => scoreProfile(b) - scoreProfile(a));
      });
    };

    try {
      const query = searchQuery.trim();
      const queryLower = query.toLowerCase();
      const isNip05 = query.includes('@');
      
      // 1. Resolve NIP-05 or npub immediately
      let targetPk: string | null = null;
      if (isNip05) {
        try {
          // nip05.queryProfile doesn't natively support AbortSignal in all versions, 
          // but we can wrap it or just check signal after.
          const res = await nip05.queryProfile(query);
          if (controller.signal.aborted) return;
          
          if (res) {
            targetPk = res.pubkey;
            const profileRelays = res.relays || [];
            const fetchRelays = [...new Set([...DEFAULT_RELAYS, ...SEARCH_RELAYS, ...profileRelays])];
            const p = await fetchProfile(targetPk, true, fetchRelays, controller.signal);
            const r = await fetchTrustScores(targetPk, controller.signal);
            if (p && !controller.signal.aborted) {
              updateResults([{ pubkey: targetPk, profile: p, trustScores: r }]);
              setIsSearching(false);
              setSearchAbortController(null);
              return;
            }
          }
        } catch (e) { 
          if (e instanceof Error && e.name === 'AbortError') return;
          console.warn("NIP-05 resolution failed", e); 
        }
      } else if (query.startsWith('npub1')) {
        try {
          const decoded = nip19.decode(query) as any;
          if (decoded.type === 'npub') targetPk = decoded.data;
        } catch (e) {}
      } else if (query.length === 64 && /^[0-9a-f]+$/.test(query)) {
        targetPk = query;
      }

      if (targetPk && !isNip05 && !query.startsWith('npub1') && !controller.signal.aborted) {
        const p = await fetchProfile(targetPk, false, [...DEFAULT_RELAYS, ...SEARCH_RELAYS], controller.signal);
        const r = await fetchTrustScores(targetPk, controller.signal);
        if (p && !controller.signal.aborted) {
          updateResults([{ pubkey: targetPk, profile: p, trustScores: r }]);
        }
      }

      if (controller.signal.aborted) return;

      // 2. Local Search (Instant)
      const fuseOptions = {
        keys: [
          { name: 'profile.name', weight: 1.0 },
          { name: 'profile.display_name', weight: 1.0 },
          { name: 'profile.nip05', weight: 0.8 },
          { name: 'petname', weight: 1.2 },
          { name: 'pubkey', weight: 0.5 }
        ],
        threshold: 0.35,
        distance: 100,
        ignoreLocation: true,
        useExtendedSearch: true,
        findAllMatches: true
      };

      const localFuse = new Fuse(contacts, fuseOptions);
      const localResults = localFuse.search(query);
      const localMatches = localResults.map(res => {
        const c = res.item as Contact;
        return { ...c, isWoT: wotPubkeys.includes(c.pubkey), followedBy: wotFollowMap[c.pubkey] };
      });
      updateResults(localMatches);

      if (controller.signal.aborted) return;

      // 3. Global Relay Search (NIP-50)
      const globalSearchPromise = (async () => {
        try {
          const searchEvents = await Promise.race([
            pool.current.querySync(SEARCH_RELAYS, {
              kinds: [0],
              search: query,
              limit: 50
            }),
            new Promise<Event[]>((_, reject) => {
              const timeoutId = setTimeout(() => reject(new Error('Search timeout')), 10000);
              controller.signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
                reject(new Error('AbortError'));
              });
            })
          ]);
          
          if (controller.signal.aborted) return;

          const newResults: Contact[] = [];
          for (const ev of searchEvents) {
            try {
              const profile = JSON.parse(ev.content);
              newResults.push({
                pubkey: ev.pubkey,
                profile,
                isWoT: wotPubkeys.includes(ev.pubkey),
                followedBy: wotFollowMap[ev.pubkey]
              });
            } catch (e) {}
          }
          
          if (newResults.length > 0 && !controller.signal.aborted) {
            updateResults(newResults);
          }
        } catch (e) {
          if (e instanceof Error && e.message === 'AbortError') return;
          console.warn("Global search failed or timed out", e);
        }
      })();

      // 4. WoT Search (Parallel)
      const wotSearchPromise = (async () => {
        try {
          const { secondDegree: secondDegreePubkeys, followMap: currentFollowMap } = await getWoTPubkeys(controller.signal);
          if (controller.signal.aborted) return;
          
          const combinedWoT = secondDegreePubkeys.filter(pk => !seenPubkeys.has(pk));
          if (combinedWoT.length === 0) return;

          const batchSize = 50;
          const limit = 200;
          
          for (let i = 0; i < Math.min(combinedWoT.length, limit); i += batchSize) {
            if (controller.signal.aborted) break;
            const batch = combinedWoT.slice(i, i + batchSize);
            
            const events = await Promise.race([
              pool.current.querySync(SEARCH_RELAYS, {
                kinds: [0],
                authors: batch,
                limit: batch.length
              }),
              new Promise<Event[]>((_, reject) => {
                const timeoutId = setTimeout(() => reject(new Error('WoT batch timeout')), 8000);
                controller.signal.addEventListener('abort', () => {
                  clearTimeout(timeoutId);
                  reject(new Error('AbortError'));
                });
              })
            ]);

            if (controller.signal.aborted) break;

            const wotResults: Contact[] = [];
            for (const ev of events) {
              try {
                const profile = JSON.parse(ev.content);
                const name = (profile.name || profile.display_name || '').toLowerCase();
                const nip05Str = (profile.nip05 || '').toLowerCase();
                
                if (name.includes(queryLower) || nip05Str.includes(queryLower) || ev.pubkey.includes(queryLower)) {
                  wotResults.push({
                    pubkey: ev.pubkey,
                    profile,
                    isWoT: true,
                    followedBy: currentFollowMap[ev.pubkey]
                  });
                }
              } catch (e) {}
            }
            
            if (wotResults.length > 0 && !controller.signal.aborted) {
              updateResults(wotResults);
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message === 'AbortError') return;
          console.warn("WoT search failed", e);
        }
      })();

      await Promise.all([globalSearchPromise, wotSearchPromise]);

      if (seenPubkeys.size === 0 && !controller.signal.aborted) {
        showToast("No results found on relays", "info");
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log("Search aborted");
      } else {
        console.error("Search error", err);
        showToast("Search failed", "error");
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
        setSearchAbortController(null);
      }
    }
  };

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const fuse = new Fuse(contacts, {
      keys: ['profile.name', 'profile.display_name', 'profile.nip05', 'petname', 'pubkey'],
      threshold: 0.3,
      ignoreLocation: true
    });
    return fuse.search(searchQuery).map(res => res.item as Contact);
  }, [contacts, searchQuery]);

  const filteredConversations = useMemo(() => {
    const list = !searchQuery.trim() ? conversations.filter(Boolean) : new Fuse(conversations.filter(Boolean), {
      keys: ['profile.name', 'profile.display_name', 'profile.nip05', 'pubkey', 'lastMessage.content'],
      threshold: 0.3,
      ignoreLocation: true
    }).search(searchQuery).map(res => res.item as Conversation);
    
    return [...list].sort((a, b) => b.lastMessage.created_at - a.lastMessage.created_at);
  }, [conversations, searchQuery]);

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

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <button 
                onClick={() => window.nostr && loginNip07()} 
                className="w-full py-4 bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white font-bold rounded-none border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 group"
              >
                <Smartphone size={20} className="text-blue-500 group-hover:scale-110 transition-transform" />
                Login with Extension (NIP-07)
              </button>
              <button 
                onClick={() => setShowBunkerInput(true)} 
                className="w-full py-4 bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white font-bold rounded-none border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 group"
              >
                <Shield size={20} className="text-emerald-500 group-hover:scale-110 transition-transform" />
                Login with Bunker (NIP-46)
              </button>
            </div>

            <div className="py-4 border-y border-zinc-100 dark:border-zinc-900">
              <button 
                onClick={() => loginLocal(generateSecretKey())} 
                className="w-full py-4 bg-gradient-to-br from-emerald-500 via-emerald-600 to-blue-600 text-white font-bold rounded-none hover:opacity-90 transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
              >
                Start New Identity
              </button>
            </div>

            <button 
              onClick={() => setShowKeyInput(true)} 
              className="w-full py-3 text-zinc-500 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-widest hover:text-black dark:hover:text-white transition-colors flex items-center justify-center gap-2"
            >
              <Key size={12} />
              Login with private key
            </button>
          </div>

          <p className="text-[10px] text-zinc-600 leading-relaxed uppercase tracking-widest font-bold">
            Search profiles, send messages. Nostr.
          </p>
        </motion.div>

        <AnimatePresence>
          {showKeyInput && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowKeyInput(false)} className="absolute inset-0 bg-black/80 dark:bg-black/90 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm max-h-[90vh] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-8 rounded-none space-y-6 shadow-2xl overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
                <div className="space-y-1">
                  <h3 className="text-xl font-bold">Login</h3>
                  <p className="text-xs text-zinc-500">Enter your nsec or hex private key</p>
                </div>
                <input 
                  type="password" 
                  placeholder="nsec1... or hex" 
                  value={keyInput} 
                  onChange={(e) => setKeyInput(e.target.value)} 
                  className="w-full bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-none px-4 py-4 text-sm focus:outline-none focus:border-black dark:focus:border-white transition-colors slanted-box" 
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
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm max-h-[90vh] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-8 rounded-none space-y-6 shadow-2xl overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
                <div className="space-y-1">
                  <h3 className="text-xl font-bold">Nostr Connect</h3>
                  <p className="text-xs text-zinc-500">Enter your Bunker URI (bunker://...)</p>
                </div>
                <input 
                  type="text" 
                  placeholder="bunker://..." 
                  value={bunkerUri} 
                  onChange={(e) => setBunkerUri(e.target.value)} 
                  className="w-full bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-none px-4 py-4 text-sm focus:outline-none focus:border-black dark:focus:border-white transition-colors slanted-box" 
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
            <HexagonAvatar 
              src={profile?.picture} 
              size={40} 
              onClick={() => setSelectedProfile(pubKey)}
            />
            <button 
              onClick={() => setSelectedProfile(pubKey)}
              className="min-w-0 text-left group"
            >
              <h2 className="font-black text-sm tracking-tighter italic leading-none group-hover:text-emerald-500 transition-all duration-500">PAM_</h2>
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
            className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-all duration-500 border-b-2 ${sidebarTab === 'conversations' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-400 border-transparent hover:text-zinc-600 dark:hover:text-zinc-200'}`}
          >
            Messages
          </button>
          <button 
            onClick={() => setSidebarTab('contacts')}
            className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-all duration-500 border-b-2 ${sidebarTab === 'contacts' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-400 border-transparent hover:text-zinc-600 dark:hover:text-zinc-200'}`}
          >
            Contacts
          </button>
          <button 
            onClick={() => setSidebarTab('priority')}
            className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-all duration-500 border-b-2 ${sidebarTab === 'priority' ? 'text-emerald-500 border-emerald-500' : 'text-zinc-400 border-transparent hover:text-zinc-600 dark:hover:text-zinc-200'}`}
          >
            Priority
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-900 bg-zinc-50/30 dark:bg-zinc-950/30">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
              <input 
                type="text" 
                placeholder={sidebarTab === 'contacts' ? "Search contacts or npub..." : sidebarTab === 'priority' ? "Search priority or npub..." : "Search messages..."} 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()} 
                className="w-full pl-10 pr-10 py-3 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-none text-sm focus:outline-none focus:border-emerald-500 transition-colors slanted-box" 
              />
              {isSearching ? (
                <button 
                  onClick={cancelSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-red-500 transition-colors"
                  title="Cancel Search"
                >
                  <Loader2 size={14} className="animate-spin" />
                </button>
              ) : searchQuery && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {sidebarTab === 'contacts' && (
                    <button 
                      onClick={handleSearch}
                      className="p-1 text-emerald-500 hover:text-emerald-600 transition-colors"
                      title="Search on Relays"
                    >
                      <Zap size={14} />
                    </button>
                  )}
                  <button 
                    onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                    className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
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
                      <HexagonAvatar src={res.profile?.picture} size={40} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-bold truncate group-hover:text-emerald-500 transition-all duration-500 shrink">{getDisplayName(res.pubkey, res.profile)}</p>
                          {res.profile?.nip05 && (
                            <CheckCircle size={10} className="text-emerald-500 shrink-0" title={`Verified: ${res.profile.nip05}`} />
                          )}
                          <ProfileBadges 
                            isFollowed={contacts.filter(Boolean).some(c => c.pubkey === res.pubkey)}
                            isPriority={res.isPriority}
                            isWoT={res.isWoT}
                            followedByCount={res.followedBy?.length}
                          />
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono truncate">{res.profile?.nip05 || formatNpub(res.pubkey).slice(0, 16) + '...'}</p>
                        {res.trustScores && res.trustScores.length > 0 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Star size={8} className="text-amber-500 fill-amber-500" />
                            <span className="text-[8px] font-bold text-amber-600">
                              {(res.trustScores.reduce((acc, r) => acc + r.score, 0) / res.trustScores.length * 100).toFixed(0)}%
                            </span>
                            <span className="text-[7px] text-zinc-400">({res.trustScores.length} scores)</span>
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                  <button onClick={() => setSearchResults([])} className="w-full py-2 text-[9px] text-zinc-400 hover:text-black dark:hover:text-white uppercase font-bold tracking-widest">Clear Results</button>
                </div>
              ) : filteredContacts.length > 0 ? (
                filteredContacts.map(contact => (
                  <div 
                    key={contact.pubkey} 
                    className={`w-full p-2 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all duration-500 group rounded-none ${activeChat === contact.pubkey ? 'bg-zinc-100 dark:bg-zinc-900' : ''}`}
                  >
                    <div className="relative shrink-0">
                      <HexagonAvatar 
                        src={contact.profile?.picture} 
                        size={40} 
                        onClick={() => setSelectedProfile(contact.pubkey)}
                      />
                      {conversations.find(c => c && c.pubkey === contact.pubkey)?.unreadCount > 0 && (
                        <div className="absolute top-0 right-0 w-3.5 h-3.5 bg-emerald-500 text-white rounded-none text-[7px] font-bold flex items-center justify-center border-2 border-white dark:border-black z-10">
                          {conversations.find(c => c && c.pubkey === contact.pubkey)?.unreadCount}
                        </div>
                      )}
                    </div>
                    <button 
                      onClick={() => setActiveChat(contact.pubkey)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-bold truncate group-hover:text-emerald-500 transition-all duration-500 shrink">{getDisplayName(contact.pubkey, contact.profile)}</p>
                        <ProfileBadges 
                          isFollowed={true}
                          isPriority={priorityPubkeys.includes(contact.pubkey)}
                          isWoT={wotPubkeys.includes(contact.pubkey)}
                          followedByCount={wotFollowMap[contact.pubkey]?.length}
                        />
                      </div>
                      <p className="text-[10px] text-zinc-500 font-mono truncate">
                        {getMessagePreview(conversations.find(c => c && c.pubkey === contact.pubkey)?.lastMessage) || formatNpub(contact.pubkey).slice(0, 16) + '...'}
                      </p>
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
          ) : sidebarTab === 'priority' ? (
            <div className="p-2 space-y-1">
              {priorityPubkeys.length > 0 ? (
                priorityPubkeys.map(pk => {
                  const contact = contacts.filter(Boolean).find(c => c.pubkey === pk) || searchResults.find(r => r.pubkey === pk);
                  return (
                    <div 
                      key={pk} 
                      className="w-full p-2 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group rounded-none"
                    >
                      <div className="relative shrink-0">
                        <HexagonAvatar 
                          src={contact?.profile?.picture} 
                          size={40} 
                          onClick={() => setSelectedProfile(pk)}
                        />
                        {conversations.find(c => c && c.pubkey === pk)?.unreadCount > 0 && (
                          <div className="absolute top-0 right-0 w-3.5 h-3.5 bg-emerald-500 text-white rounded-none text-[7px] font-bold flex items-center justify-center border-2 border-white dark:border-black z-10">
                            {conversations.find(c => c && c.pubkey === pk)?.unreadCount}
                          </div>
                        )}
                      </div>
                      <button 
                        onClick={() => setActiveChat(pk)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm font-bold truncate group-hover:text-amber-500 transition-colors shrink">{getDisplayName(pk, contact?.profile)}</p>
                          <ProfileBadges 
                            isFollowed={contacts.filter(Boolean).some(c => c.pubkey === pk)}
                            isPriority={true}
                            isWoT={wotPubkeys.includes(pk)}
                            followedByCount={wotFollowMap[pk]?.length}
                          />
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono truncate">
                          {getMessagePreview(conversations.find(c => c && c.pubkey === pk)?.lastMessage) || formatNpub(pk).slice(0, 16) + '...'}
                        </p>
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); togglePriority(pk); }}
                        className="p-2 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        title="Remove Priority"
                      >
                        <ShieldAlert size={16} />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="p-12 text-center space-y-2 opacity-50">
                  <ShieldCheck size={24} className="mx-auto text-zinc-400" />
                  <p className="text-[10px] uppercase tracking-widest font-bold">No priority profiles</p>
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
                    <div className="relative shrink-0">
                      <HexagonAvatar 
                        src={conv.profile?.picture} 
                        size={48} 
                        onClick={() => setSelectedProfile(conv.pubkey)}
                      />
                      {conv.unreadCount > 0 && <div className="absolute top-0 right-0 w-4 h-4 bg-emerald-500 text-white rounded-none text-[8px] font-bold flex items-center justify-center border-2 border-white dark:border-black z-10">{conv.unreadCount}</div>}
                    </div>
                    <button 
                      onClick={() => setActiveChat(conv.pubkey)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex justify-between items-baseline mb-0.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <p className={`text-sm font-bold truncate shrink ${activeChat === conv.pubkey ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{getDisplayName(conv.pubkey, conv.profile)}</p>
                          <ProfileBadges 
                            isFollowed={contacts.filter(Boolean).some(c => c.pubkey === conv.pubkey)}
                            isPriority={priorityPubkeys.includes(conv.pubkey)}
                            isWoT={wotPubkeys.includes(conv.pubkey)}
                            followedByCount={wotFollowMap[conv.pubkey]?.length}
                          />
                        </div>
                        <span className="text-[9px] text-zinc-400 dark:text-zinc-600 font-mono shrink-0 ml-2">{formatDistanceToNow(conv.lastMessage.created_at * 1000)}</span>
                      </div>
                      <p className="text-xs truncate text-zinc-500 leading-tight">{getMessagePreview(conv.lastMessage)}</p>
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
      <div className={`flex-1 min-w-0 flex flex-col bg-white dark:bg-black ${!activeChat ? 'hidden md:flex' : 'flex'}`}>
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
                <HexagonAvatar 
                  src={conversations.find(c => c && c.pubkey === activeChat)?.profile?.picture} 
                  size={40} 
                  onClick={() => setSelectedProfile(activeChat)}
                />
                <button 
                  onClick={() => setSelectedProfile(activeChat)}
                  className="text-left group min-w-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="font-bold text-base group-hover:text-emerald-500 transition-colors truncate shrink">{getDisplayName(activeChat, conversations.find(c => c && c.pubkey === activeChat)?.profile)}</h2>
                    <ProfileBadges 
                      isFollowed={contacts.filter(Boolean).some(c => c.pubkey === activeChat)}
                      isPriority={priorityPubkeys.includes(activeChat!)}
                      isWoT={wotPubkeys.includes(activeChat!)}
                      followedByCount={wotFollowMap[activeChat!]?.length}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">{formatNpub(activeChat).slice(0, 24)}...</p>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={syncMessages}
                  disabled={isSyncingMessages}
                  className={`p-2 rounded-full transition-colors ${isSyncingMessages ? 'animate-spin text-zinc-400' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500'}`}
                  title="Sync Messages"
                >
                  <RotateCcw size={18} />
                </button>
                <button 
                  onClick={() => setActiveChat(null)} 
                  className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-red-500 transition-colors"
                  title="Close Chat"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Message Composer (Moved to Top) */}
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-900 bg-white dark:bg-black sticky top-0 z-30">
              <div className="max-w-4xl mx-auto space-y-4">
                {!hasPublishedBlossomList && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-4 slanted-box"
                  >
                    <div className="flex items-center gap-3">
                      <HardDrive size={16} className="text-emerald-500" />
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                        Media uploads disabled. Publish your Blossom Server list (Kind 10063) to enable.
                      </p>
                    </div>
                    <button 
                      onClick={() => {
                        setSettingsTab('blossom');
                        setShowSettings(true);
                      }}
                      className="px-3 py-1 bg-emerald-500 text-white text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-600 transition-colors"
                    >
                      Setup Now
                    </button>
                  </motion.div>
                )}
                {Object.keys(pendingMessages).length > 0 && (
                  <div className="space-y-2">
                    {Object.keys(pendingMessages).map(id => {
                      const msg = pendingMessages[id];
                      return (
                        <motion.div 
                          key={id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="flex items-center justify-between p-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                              Sending in {msg.timeLeft}s...
                            </span>
                          </div>
                          <button 
                            onClick={() => cancelPendingMessage(id)}
                            className="px-3 py-1 bg-red-500 text-white text-[9px] font-bold uppercase tracking-widest hover:bg-red-600 transition-colors"
                          >
                            Undo
                          </button>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
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
                  {pendingImagePreview ? (
                    <div 
                      className="flex-1 flex flex-col gap-2 p-3 bg-zinc-50 dark:bg-zinc-950 border border-emerald-500/30 slanted-box outline-none image-preview-container"
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setPendingImage(null);
                          setPendingImagePreview(null);
                        }
                      }}
                      tabIndex={0}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Image Preview</span>
                        <button 
                          onClick={() => {
                            setPendingImage(null);
                            setPendingImagePreview(null);
                          }}
                          className="p-1 hover:text-red-500 transition-colors"
                          title="Cancel"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="relative group self-start max-w-full">
                        <img 
                          src={pendingImagePreview} 
                          alt="Preview" 
                          className="max-h-64 w-auto object-contain rounded-none border border-zinc-200 dark:border-zinc-800 shadow-xl"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-900">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[200px]">
                            {pendingImage?.name}
                          </span>
                          <span className="text-[8px] text-zinc-400 font-mono">
                            {((pendingImage?.size || 0) / 1024).toFixed(1)} KB
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={discardImage}
                            className="px-4 py-2 text-zinc-500 text-[10px] font-bold uppercase tracking-widest hover:text-red-500 transition-colors"
                          >
                            Discard
                          </button>
                          <button 
                            onClick={async () => {
                              if (!pendingImage) return;
                              setIsUploading(true);
                              setUploadProgress(0);
                              showToast("Starting upload...", "info");
                              try {
                                console.log("Starting Blossom upload for:", pendingImage.name);
                                const url = await uploadToBlossom(pendingImage);
                                console.log("Upload successful, URL:", url);
                                await sendMessage(url, 'image', undefined, pendingImage.type);
                                setPendingImage(null);
                                setPendingImagePreview(null);
                              } catch (err) {
                                if (err instanceof Error && err.message === 'Upload aborted by user') {
                                  console.log("Image upload aborted by user");
                                } else {
                                  console.error("Upload failed:", err);
                                  showToast("Failed to upload image: " + (err instanceof Error ? err.message : String(err)), "error");
                                }
                              } finally {
                                setIsUploading(false);
                              }
                            }}
                            disabled={isUploading}
                            className="relative px-8 py-2 bg-gradient-to-br from-emerald-500 to-blue-600 text-white text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-emerald-500/20 overflow-hidden"
                          >
                            {isUploading && (
                              <motion.div 
                                className="absolute inset-0 bg-emerald-600/20 z-0"
                                initial={{ width: 0 }}
                                animate={{ width: `${uploadProgress}%` }}
                                transition={{ duration: 0.1 }}
                              />
                            )}
                            <span className="relative z-10 flex items-center gap-2">
                              {isUploading ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" />
                                  <span>{uploadProgress}% Uploading...</span>
                                </>
                              ) : (
                                <>
                                  <Send size={12} />
                                  <span>Send Image</span>
                                </>
                              )}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : isRecording ? (
                    <div className="flex-1 flex items-center gap-4 px-6 py-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 transition-all animate-pulse">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="flex-1 text-sm font-mono text-red-500 font-bold tracking-widest">{formatDuration(recordingDuration)} / 2:00</span>
                      <button 
                        onClick={stopRecording}
                        className="p-2 text-red-500 hover:bg-red-500/10 transition-colors"
                        title="Stop Recording"
                      >
                        <Square size={20} fill="currentColor" />
                      </button>
                    </div>
                  ) : audioUrl ? (
                    <div className="flex-1 flex flex-col bg-zinc-50 dark:bg-zinc-950 border border-emerald-500/30 overflow-hidden">
                      <div className="flex items-center gap-4 px-4 py-2 border-b border-zinc-200 dark:border-zinc-900">
                        <div className="flex-1">
                          <AudioPlayer src={audioUrl} isSelf={true} initialDuration={recordingDuration} mimeType={audioBlob?.type} />
                        </div>
                        <button 
                          onClick={discardRecording}
                          className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                          title="Discard"
                        >
                          <X size={20} />
                        </button>
                      </div>
                      
                      <div className="px-4 py-2 bg-zinc-100/50 dark:bg-zinc-900/50 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                          <Mic size={10} className="text-red-500" />
                          <span>Voice Message • {formatDuration(recordingDuration)}</span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={discardRecording}
                            className="px-4 py-2 text-zinc-500 hover:text-red-500 text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                          >
                            Discard
                          </button>
                          <button 
                            onClick={async () => {
                              if (!audioUrl || !audioBlob) return;
                              setIsUploading(true);
                              setUploadProgress(0);
                              showToast("Starting audio upload...", "info");
                              try {
                                console.log("Starting Blossom upload for audio:", audioBlob.type);
                                const url = await uploadToBlossom(audioBlob);
                                console.log("Audio upload successful, URL:", url);
                                await sendMessage(url, 'voice', recordingDuration, audioBlob.type);
                                discardRecording();
                              } catch (err) {
                                if (err instanceof Error && err.message === 'Upload aborted by user') {
                                  console.log("Audio upload aborted by user");
                                } else {
                                  console.error("Audio upload failed:", err);
                                  showToast("Failed to upload audio: " + (err instanceof Error ? err.message : String(err)), "error");
                                }
                              } finally {
                                setIsUploading(false);
                              }
                            }}
                            disabled={isUploading}
                            className="relative px-8 py-2 bg-gradient-to-br from-red-500 to-orange-600 text-white text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-red-500/20 overflow-hidden"
                          >
                            {isUploading && (
                              <motion.div 
                                className="absolute inset-0 bg-red-600/20 z-0"
                                initial={{ width: 0 }}
                                animate={{ width: `${uploadProgress}%` }}
                                transition={{ duration: 0.1 }}
                              />
                            )}
                            <span className="relative z-10 flex items-center gap-2">
                              {isUploading ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" />
                                  <span>{uploadProgress}% Uploading...</span>
                                </>
                              ) : (
                                <>
                                  <Send size={12} />
                                  <span>Send Voice Message</span>
                                </>
                              )}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <input 
                      type="text" 
                      placeholder="Message..." 
                      value={newMessage} 
                      onChange={(e) => setNewMessage(e.target.value)} 
                      onKeyDown={(e) => e.key === 'Enter' && sendMessage()} 
                      className="flex-1 px-6 py-4 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-none focus:outline-none focus:border-emerald-500 transition-colors slanted-box" 
                    />
                  )}

                  <div className="flex items-center gap-2">
                    <input 
                      type="file" 
                      id="image-upload" 
                      className="hidden" 
                      accept="image/*" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setPendingImage(file);
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setPendingImagePreview(reader.result as string);
                        };
                        reader.readAsDataURL(file);
                        // Reset input so same file can be selected again
                        e.target.value = '';
                      }}
                    />
                  </div>

                  {userBlossomServers.length > 0 && (
                    <div className="relative z-50">
                      <button 
                        onClick={() => setShowBlossomMenu(!showBlossomMenu)}
                        className={`p-4 bg-zinc-100 dark:bg-zinc-900 rounded-none transition-colors ${showBlossomMenu ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-500 hover:text-emerald-500'}`}
                        title="Media Server Settings"
                      >
                        <HardDrive size={20} />
                      </button>
                      {showBlossomMenu && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowBlossomMenu(false)} />
                          <div className="absolute top-full left-0 mt-2 z-50">
                            <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-2xl p-2 min-w-[200px] space-y-1">
                              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest px-2 pb-1 border-b border-zinc-100 dark:border-zinc-900">Media Server</p>
                              {(userBlossomServers.length > 0 ? userBlossomServers : DEFAULT_BLOSSOM_SERVERS).map(server => {
                                const isPreferred = preferredBlossomServer && 
                                  (server.endsWith('/') ? server.slice(0, -1) : server) === 
                                  (preferredBlossomServer.endsWith('/') ? preferredBlossomServer.slice(0, -1) : preferredBlossomServer);
                                
                                return (
                                  <button
                                    key={server}
                                    onClick={() => {
                                      setPreferredBlossomServer(server);
                                      localStorage.setItem('pam_preferred_blossom', server);
                                      setShowBlossomMenu(false);
                                    }}
                                    className={`w-full text-left px-2 py-1.5 text-[9px] font-medium transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 flex items-center justify-between ${isPreferred ? 'text-emerald-500' : 'text-zinc-500'}`}
                                  >
                                    <span className="truncate max-w-[140px]">{server.replace('https://', '')}</span>
                                    {isPreferred && <Check size={10} />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {!isRecording && !audioUrl && !pendingImagePreview && (
                    <button 
                      onClick={() => {
                        if (!hasPublishedBlossomList) {
                          setSettingsTab('blossom');
                          setShowSettings(true);
                          showToast("Please publish your Media Server list (Kind 10063) first", "info");
                          return;
                        }
                        if (!preferredBlossomServer) {
                          showToast("Please select a Media Server first", "info");
                          return;
                        }
                        document.getElementById('image-upload')?.click();
                      }} 
                      className={`p-4 bg-zinc-100 dark:bg-zinc-900 rounded-none transition-colors ${(!preferredBlossomServer || !hasPublishedBlossomList) ? 'text-zinc-300 dark:text-zinc-800 cursor-not-allowed' : 'text-zinc-400 dark:text-zinc-500 hover:text-emerald-500'}`}
                      title={!hasPublishedBlossomList ? "Publish Kind 10063 to enable uploads" : (preferredBlossomServer ? "Upload Image" : "Select a Media Server to upload")}
                    >
                      <ImageIcon size={20} className={(!preferredBlossomServer || !hasPublishedBlossomList) ? 'opacity-50' : ''} />
                    </button>
                  )}

                  {!isRecording && !audioUrl && !pendingImagePreview && (
                    <button 
                      onClick={() => {
                        if (!hasPublishedBlossomList) {
                          setSettingsTab('blossom');
                          setShowSettings(true);
                          showToast("Please publish your Media Server list (Kind 10063) first", "info");
                          return;
                        }
                        startRecording();
                      }}
                      className={`p-4 bg-zinc-100 dark:bg-zinc-900 rounded-none transition-colors ${(!preferredBlossomServer || !hasPublishedBlossomList) ? 'text-zinc-300 dark:text-zinc-800 cursor-not-allowed' : 'text-zinc-400 dark:text-zinc-500 hover:text-red-500'}`}
                      title={!hasPublishedBlossomList ? "Publish Kind 10063 to enable recording" : (preferredBlossomServer ? "Record Voice Message" : "Select a Media Server to record")}
                    >
                      <Mic size={20} className={(!preferredBlossomServer || !hasPublishedBlossomList) ? 'opacity-50' : ''} />
                    </button>
                  )}

                  {newMessage.trim() && !audioUrl && !isRecording && !pendingImagePreview && (
                    <button 
                      onClick={() => sendMessage()}
                      disabled={isMining || isUploading} 
                      className="p-4 bg-gradient-to-br from-emerald-500 via-emerald-600 to-blue-600 text-white rounded-none disabled:opacity-50 hover:opacity-90 transition-all shadow-lg shadow-emerald-500/20"
                    >
                      {isMining || isUploading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8 relative z-0">
              {messages.filter(m => m && m.id && (m.sender === activeChat || m.receiver === activeChat) && !deletedMessageIds.has(m.id))
                .sort((a, b) => b.created_at - a.created_at)
                .map(msg => (
                <div key={msg.id} className={`flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}>
                  <div 
                    className={`max-w-[90%] md:max-w-[70%] px-4 md:px-5 py-3 rounded-none leading-relaxed slanted-box break-words whitespace-pre-wrap ${msg.isSelf ? 'bg-gradient-to-br from-zinc-800 via-zinc-900 to-black text-white shadow-lg shadow-black/20' : 'bg-gradient-to-br from-zinc-200 via-zinc-300 to-zinc-400 text-black border border-zinc-200 dark:border-zinc-800'}`}
                  >
                    {msg.type === 'image' ? (
                      <div className="space-y-2">
                        <img src={msg.content} alt="Shared image" className="max-w-full h-auto rounded-none border border-zinc-200 dark:border-zinc-800" referrerPolicy="no-referrer" />
                        <a href={msg.content} target="_blank" rel="noopener noreferrer" className="text-[10px] underline opacity-50 hover:opacity-100 block">View original</a>
                      </div>
                    ) : msg.type === 'voice' ? (
                      <AudioPlayer src={msg.content} isSelf={msg.isSelf} initialDuration={msg.duration} mimeType={msg.mimeType} />
                    ) : (
                      msg.content
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2 px-1">
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-600 uppercase font-bold tracking-wider">{formatDistanceToNow(msg.created_at * 1000)} ago</span>
                    <button onClick={() => setDeletedMessageIds(prev => new Set(prev).add(msg.id))} className="text-[9px] text-zinc-300 dark:text-zinc-800 hover:text-emerald-500 transition-colors">Hide</button>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </>
        )}
      </div>

      {/* Trust Score Form Modal */}
      <AnimatePresence>
        {showTrustScoreForm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setShowTrustScoreForm(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm max-h-[90vh] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 p-8 rounded-none space-y-6 shadow-2xl overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800"
            >
              <div className="space-y-1">
                <h3 className="text-xl font-bold uppercase tracking-tighter">Assign Trust Score</h3>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">How much do you trust this profile?</p>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Trust Level</label>
                  <div className="flex items-center gap-2">
                    {[...Array(5)].map((_, i) => (
                      <button 
                        key={i} 
                        onClick={() => setTrustScoreValue((i + 1) / 5)}
                        className="p-1 hover:scale-110 transition-transform"
                      >
                        <Star 
                          size={24} 
                          className={i < trustScoreValue * 5 ? 'text-amber-500 fill-amber-500' : 'text-zinc-200 dark:text-zinc-800'} 
                        />
                      </button>
                    ))}
                    <span className="text-sm font-bold text-amber-500 ml-2">{(trustScoreValue * 100).toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Trust Context</label>
                  <textarea 
                    value={trustScoreContext}
                    onChange={(e) => setTrustScoreContext(e.target.value)}
                    placeholder="Why do you trust (or distrust) this user?"
                    className="w-full h-32 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-none px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors resize-none slanted-box"
                  />
                </div>
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowTrustScoreForm(false)}
                  className="flex-1 py-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={submitTrustScore}
                  disabled={!trustScoreContext.trim()}
                  className="flex-1 py-4 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  Publish Score
                </button>
              </div>
            </motion.div>
          </div>
        )}

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
              className="relative w-full max-w-sm max-h-[90vh] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 shadow-2xl overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800"
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
                <HexagonAvatar 
                  src={viewingProfile?.picture} 
                  size={96} 
                  className="mb-4"
                  fallback={!viewingProfile ? <Loader2 size={32} className="animate-spin text-emerald-500/20" /> : undefined}
                />

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
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-xl font-black italic tracking-tighter truncate shrink">
                          {getDisplayName(selectedProfile!, viewingProfile)}
                        </h3>
                        {contacts.find(c => c && c.pubkey === selectedProfile)?.petname && (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-600 font-medium italic shrink-0">
                            ({viewingProfile?.display_name || viewingProfile?.name || 'Anonymous'})
                          </span>
                        )}
                        <ProfileBadges 
                          isFollowed={contacts.filter(Boolean).some(c => c.pubkey === selectedProfile)}
                          isPriority={priorityPubkeys.includes(selectedProfile!)}
                          isWoT={wotPubkeys.includes(selectedProfile!)}
                          followedByCount={wotFollowMap[selectedProfile!]?.length}
                          className="mt-1"
                        />
                      </div>
                      {viewingProfile?.nip05 && (
                        <p className="text-xs text-emerald-500 font-medium">{viewingProfile.nip05}</p>
                      )}
                      <p className="text-[10px] text-zinc-500 font-mono tracking-tight break-all">
                        {formatNpub(selectedProfile)}
                      </p>
                    </div>

                    {selectedProfile !== pubKey && (
                      <div className="mt-4">
                        {isEditingPetname ? (
                          <div className="flex gap-2">
                            <input 
                              type="text"
                              value={petnameInput}
                              onChange={(e) => setPetnameInput(e.target.value)}
                              placeholder="Assign petname..."
                              className="flex-1 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium focus:outline-none focus:border-emerald-500 slanted-box"
                              autoFocus
                            />
                            <button 
                              onClick={() => {
                                updatePetname(selectedProfile!, petnameInput);
                                setIsEditingPetname(false);
                              }}
                              className="px-4 py-2 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 transition-colors"
                            >
                              Save
                            </button>
                            <button 
                              onClick={() => setIsEditingPetname(false)}
                              className="px-4 py-2 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => setIsEditingPetname(true)}
                            className="text-[10px] font-bold text-zinc-400 hover:text-emerald-500 uppercase tracking-tighter flex items-center gap-1.5 transition-colors"
                          >
                            <Type size={12} /> {contacts.find(c => c && c.pubkey === selectedProfile)?.petname ? 'Edit Petname' : 'Assign Petname'}
                          </button>
                        )}
                      </div>
                    )}

                    {viewingTrustInfo.followedBy.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <div className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded-none flex items-center gap-1.5">
                          <Users size={10} className="text-blue-500" />
                          <span className="text-[9px] font-bold text-blue-600 uppercase tracking-tighter">
                            Followed by {viewingTrustInfo.followedBy.length} {viewingTrustInfo.followedBy.length === 1 ? 'contact' : 'contacts'}
                          </span>
                        </div>
                      </div>
                    )}

                    {viewingProfile?.about && (
                      <div className="mt-6">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">
                          {viewingProfile.about}
                        </p>
                      </div>
                    )}

                      <div className="mt-6 space-y-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Relay List (10002)</p>
                            {isViewingDefaultRelays && (
                              <span className="text-[7px] px-1 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 uppercase font-bold tracking-tighter border border-zinc-200 dark:border-zinc-800">Default fallback</span>
                            )}
                          </div>
                          {viewingRelays.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {viewingRelays.filter(Boolean).map(url => {
                                const info = relayInfoCache[url];
                                const discovery = relayDiscovery[url.replace('wss://', '').replace('ws://', '')];
                                return (
                                  <div key={url} className="flex items-center gap-2 px-2 py-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-none group relative cursor-help" title={url}>
                                    {info?.icon ? (
                                      <img src={info.icon} alt="" className="w-3 h-3 object-contain shrink-0" />
                                    ) : (
                                      <Zap size={10} className={discovery ? 'text-emerald-500' : 'text-zinc-400'} />
                                    )}
                                    <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]">
                                      {info?.name || url.replace('wss://', '').replace('ws://', '')}
                                    </span>
                                    {discovery && (
                                      <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-50 w-48 p-3 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl text-[9px] space-y-1">
                                        <p className="font-bold uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-900 pb-1 mb-1">Relay Discovery (NIP-66)</p>
                                        <div className="flex justify-between"><span>Software:</span> <span className="font-mono">{discovery.software}</span></div>
                                        <div className="flex justify-between"><span>Version:</span> <span className="font-mono">{discovery.version}</span></div>
                                        {discovery.supported_nips && (
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {discovery.supported_nips.slice(0, 5).map((n: number) => (
                                              <span key={n} className="px-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">NIP-{n}</span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-[10px] text-zinc-400 italic">No general relays found</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">DM Relays (10050)</p>
                          </div>
                          {viewingDmRelays.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {viewingDmRelays.map(url => {
                                const info = relayInfoCache[url];
                                const discovery = relayDiscovery[url.replace('wss://', '').replace('ws://', '')];
                                return (
                                  <div key={url} className="flex items-center gap-2 px-2 py-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-none group relative cursor-help" title={url}>
                                    {info?.icon ? (
                                      <img src={info.icon} alt="" className="w-3 h-3 object-contain shrink-0" />
                                    ) : (
                                      <Zap size={10} className={discovery ? 'text-emerald-500' : 'text-zinc-400'} />
                                    )}
                                    <span className="text-[10px] font-medium text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]">
                                      {info?.name || url.replace('wss://', '').replace('ws://', '')}
                                    </span>
                                    {discovery && (
                                      <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-50 w-48 p-3 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl text-[9px] space-y-1">
                                        <p className="font-bold uppercase tracking-widest border-b border-zinc-100 dark:border-zinc-900 pb-1 mb-1">Relay Discovery (NIP-66)</p>
                                        <div className="flex justify-between"><span>Software:</span> <span className="font-mono">{discovery.software}</span></div>
                                        <div className="flex justify-between"><span>Version:</span> <span className="font-mono">{discovery.version}</span></div>
                                        {discovery.supported_nips && (
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {discovery.supported_nips.slice(0, 5).map((n: number) => (
                                              <span key={n} className="px-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">NIP-{n}</span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-[10px] text-zinc-400 italic">No DM relays found (NIP-17/59)</p>
                          )}
                        </div>
                      </div>

                    {/* Trust Scores Section */}
                    <div className="mt-8 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Trust Scores</p>
                        {selectedProfile !== pubKey && (
                          <button 
                            onClick={() => setShowTrustScoreForm(true)}
                            className="text-[9px] font-bold text-emerald-500 hover:text-emerald-600 uppercase tracking-tighter"
                          >
                            Assign Score
                          </button>
                        )}
                      </div>
                      
                      {viewingTrustScores.length > 0 ? (
                        <div className="space-y-3 max-h-48 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
                          {viewingTrustScores.filter(score => score && score.id).map(score => (
                            <div key={score.id} className="p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-none space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1">
                                  {[...Array(5)].map((_, i) => (
                                    <Star 
                                      key={i} 
                                      size={10} 
                                      className={i < score.score * 5 ? 'text-amber-500 fill-amber-500' : 'text-zinc-300 dark:text-zinc-700'} 
                                    />
                                  ))}
                                  <span className="text-[9px] font-bold text-amber-600 ml-1">{(score.score * 100).toFixed(0)}%</span>
                                </div>
                                <span className="text-[8px] text-zinc-400 font-mono">
                                  {formatDistanceToNow(score.created_at * 1000)} ago
                                </span>
                              </div>
                              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed italic">
                                "{score.content}"
                              </p>
                              <div className="flex items-center gap-1.5 pt-1">
                                <div className="w-3 h-3 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                                <span className="text-[8px] text-zinc-500 font-mono truncate">
                                  {formatNpub(score.pubkey).slice(0, 12)}...
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-6 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-none opacity-50">
                          <Star size={16} className="mx-auto text-zinc-300 dark:text-zinc-700 mb-2" />
                          <p className="text-[9px] uppercase tracking-widest font-bold">No trust scores assigned</p>
                        </div>
                      )}
                    </div>
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
                          contacts.filter(Boolean).some(c => c.pubkey === selectedProfile)
                            ? 'bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-500 hover:border-red-500/30'
                            : 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20'
                        }`}
                      >
                        {contacts.filter(Boolean).some(c => c.pubkey === selectedProfile) ? (
                          <><UserMinus size={14} /> Unfollow</>
                        ) : (
                          <><UserPlus size={14} /> Follow</>
                        )}
                      </button>
                      <button 
                        disabled={!viewingProfile}
                        onClick={() => {
                          if (selectedProfile) togglePriority(selectedProfile);
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest transition-all border disabled:opacity-50 disabled:cursor-not-allowed ${
                          priorityPubkeys.includes(selectedProfile!)
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 hover:bg-amber-500/20'
                            : 'bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:text-amber-500 hover:border-amber-500/30'
                        }`}
                      >
                        {priorityPubkeys.includes(selectedProfile!) ? (
                          <><ShieldCheck size={14} /> Prioritized</>
                        ) : (
                          <><Shield size={14} /> Prioritize</>
                        )}
                      </button>
                    </div>
                    <button 
                      onClick={() => {
                        setActiveChat(selectedProfile);
                        setSelectedProfile(null);
                        setSearchResults([]);
                        setSearchQuery('');
                      }}
                      className="w-full flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-all"
                    >
                      <MessageSquare size={14} /> Message
                    </button>

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
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-none p-8 space-y-8 overflow-y-auto max-h-[90vh] shadow-2xl">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-6">
                  <h3 className="text-2xl font-bold">Settings</h3>
                  <div className="flex gap-4">
                    {(['general', 'relays', 'blossom'] as const).map(tab => (
                      <button 
                        key={tab}
                        onClick={() => setSettingsTab(tab)}
                        className={`text-[10px] font-bold uppercase tracking-widest pb-1 border-b-2 transition-all ${settingsTab === tab ? 'border-emerald-500 text-emerald-500' : 'border-transparent text-zinc-400 hover:text-zinc-600'}`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-black dark:hover:text-white"><X size={24} /></button>
              </div>

              <div className="space-y-8">
                {settingsTab === 'general' && (
                  <>
                    <div className="space-y-4">
                      <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Identity</p>
                      <div className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-none border border-zinc-200 dark:border-zinc-800 space-y-3">
                        <div className="flex items-center gap-3">
                          <HexagonAvatar 
                            src={profile?.picture} 
                            size={48} 
                          />
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
                      <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Preferences</p>
                      
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="text-xs text-zinc-400">Send Delay (10s)</p>
                          <p className="text-[8px] text-zinc-500 uppercase tracking-tighter">Undo window for sent messages</p>
                        </div>
                        <button 
                          onClick={() => {
                            const next = !sendDelayEnabled;
                            setSendDelayEnabled(next);
                            localStorage.setItem('pam_send_delay', String(next));
                          }}
                          className={`w-10 h-5 rounded-none transition-colors relative ${sendDelayEnabled ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800'}`}
                        >
                          <div className={`absolute top-1 w-3 h-3 rounded-none transition-all ${sendDelayEnabled ? 'right-1 bg-white' : 'left-1 bg-zinc-400 dark:bg-zinc-600'}`} />
                        </button>
                      </div>

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
                  </>
                )}

                {settingsTab === 'relays' && (
                  <div className="space-y-8">
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">General Relays (NIP-65)</p>
                          {userGeneralRelays.every(url => DEFAULT_RELAYS.includes(url)) && (
                            <span className="text-[8px] font-bold text-amber-500 uppercase tracking-tighter">Using defaults</span>
                          )}
                        </div>
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              value={newRelayUrl}
                              onChange={(e) => setNewRelayUrl(e.target.value)}
                              placeholder="wss://relay.example.com"
                              className="flex-1 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-none px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 transition-colors slanted-box"
                              onKeyDown={(e) => e.key === 'Enter' && addGeneralRelay()}
                            />
                            <button 
                              onClick={addGeneralRelay}
                              className="px-4 py-2 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 transition-colors"
                            >
                              Add
                            </button>
                          </div>

                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                            {userGeneralRelays.map(url => {
                              const info = relayInfoCache[url];
                              const isDefault = DEFAULT_RELAYS.includes(url);
                              return (
                                <div key={url} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-6 h-6 shrink-0 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 flex items-center justify-center overflow-hidden">
                                      {info?.icon ? (
                                        <img src={info.icon} alt="" className="w-full h-full object-contain" />
                                      ) : (
                                        <Zap size={10} className="text-zinc-400" />
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-bold truncate">{info?.name || url.replace('wss://', '').replace('ws://', '')}</p>
                                      <p className="text-[8px] text-zinc-500 font-mono truncate">{url}</p>
                                    </div>
                                    {isDefault && <span className="text-[7px] px-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 uppercase font-bold tracking-tighter border border-zinc-200 dark:border-zinc-800">Default</span>}
                                  </div>
                                  <button onClick={() => removeGeneralRelay(url)} className="p-2 text-zinc-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">DM Relays (NIP-50/10050)</p>
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
                              className="flex-1 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-none px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 transition-colors slanted-box"
                              onKeyDown={(e) => e.key === 'Enter' && addRelay()}
                            />
                            <button 
                              onClick={addRelay}
                              className="px-4 py-2 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 transition-colors"
                            >
                              Add
                            </button>
                          </div>

                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                            {userDmRelays.map(url => {
                              const info = relayInfoCache[url];
                              const isDefault = DEFAULT_RELAYS.includes(url);
                              return (
                                <div key={url} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-6 h-6 shrink-0 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 flex items-center justify-center overflow-hidden">
                                      {info?.icon ? (
                                        <img src={info.icon} alt="" className="w-full h-full object-contain" />
                                      ) : (
                                        <Zap size={10} className="text-zinc-400" />
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-bold truncate">{info?.name || url.replace('wss://', '').replace('ws://', '')}</p>
                                      <p className="text-[8px] text-zinc-500 font-mono truncate">{url}</p>
                                    </div>
                                    {isDefault && <span className="text-[7px] px-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 uppercase font-bold tracking-tighter border border-zinc-200 dark:border-zinc-800">Default</span>}
                                  </div>
                                  <button onClick={() => removeRelay(url)} className="p-2 text-zinc-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Relay Discovery (NIP-66)</p>
                        <button onClick={fetchRelayDiscovery} className="text-[9px] font-bold text-emerald-500 uppercase tracking-tighter hover:underline">Refresh</button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                        {Object.entries(relayDiscovery).map(([url, data]: [string, any]) => (
                          <div key={url} className="p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold truncate max-w-[140px]">{url}</span>
                              <button 
                                onClick={() => {
                                  const fullUrl = `wss://${url}`;
                                  if (!userDmRelays.includes(fullUrl)) {
                                    setUserDmRelays(prev => [...prev, fullUrl]);
                                    localStorage.setItem('pam_dm_relays', JSON.stringify([...userDmRelays, fullUrl]));
                                    showToast(`Added ${url}`, "success");
                                  }
                                }}
                                className="p-1 text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <span className="text-[8px] px-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-mono uppercase">{data.software} {data.version}</span>
                              {data.supported_nips?.includes(42) && <span className="text-[8px] px-1 bg-blue-500/10 text-blue-500 font-bold uppercase tracking-tighter">Auth</span>}
                              {data.supported_nips?.includes(44) && <span className="text-[8px] px-1 bg-emerald-500/10 text-emerald-500 font-bold uppercase tracking-tighter">NIP-44</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'blossom' && (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Media Servers (Blossom)</p>
                        <button 
                          onClick={() => saveBlossomServers(userBlossomServers)}
                          className={`text-[8px] font-bold uppercase tracking-widest hover:underline transition-all ${!hasPublishedBlossomList ? 'text-white bg-emerald-500 px-3 py-1.5 shadow-lg shadow-emerald-500/20' : 'text-emerald-500'}`}
                        >
                          {hasPublishedBlossomList ? 'Update Published List' : 'Publish List to Nostr (Kind 10063)'}
                        </button>
                      </div>
                      {!hasPublishedBlossomList && (
                        <div className="p-3 bg-amber-500/10 border border-amber-500/20">
                          <p className="text-[9px] text-amber-600 dark:text-amber-400 font-bold uppercase tracking-widest">
                            Action Required: You must publish your server list to enable image and voice note uploads.
                          </p>
                        </div>
                      )}
                    </div>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={newBlossomUrl}
                        onChange={(e) => setNewBlossomUrl(e.target.value)}
                        placeholder="https://blossom.example.com"
                        className="flex-1 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-none px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 transition-colors slanted-box"
                        onKeyDown={(e) => e.key === 'Enter' && addBlossomServer()}
                      />
                      <button 
                        onClick={addBlossomServer}
                        className="px-4 py-2 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 transition-colors"
                      >
                        Add
                      </button>
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                      {userBlossomServers.length > 0 ? (
                        userBlossomServers.map(url => (
                          <div key={url} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-6 h-6 shrink-0 bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 flex items-center justify-center overflow-hidden">
                                <HardDrive size={12} className="text-zinc-300 dark:text-zinc-700" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold truncate">{url.replace('https://', '').replace('http://', '')}</p>
                                <p className="text-[8px] text-zinc-500 font-mono truncate">{url}</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => removeBlossomServer(url)}
                              className="p-1.5 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="p-4 text-center border border-dashed border-zinc-200 dark:border-zinc-800 opacity-50">
                          <p className="text-[10px] uppercase tracking-widest font-bold">No servers configured</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

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
              <HexagonAvatar 
                size={80} 
                className="mx-auto"
                fallback={<Unlock size={32} className="text-emerald-500" />}
              />
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
