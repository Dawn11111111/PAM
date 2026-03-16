/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  generateSecretKey, 
  getPublicKey, 
  nip19, 
  SimplePool, 
  Event,
  UnsignedEvent,
  finalizeEvent,
  verifyEvent,
  getEventHash
} from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import * as nip46 from 'nostr-tools/nip46';
import * as nip05 from 'nostr-tools/nip05';
import { 
  User, 
  Send, 
  MessageSquare, 
  Search, 
  Settings, 
  LogOut, 
  Key, 
  Copy, 
  Check,
  ArrowLeft,
  Loader2,
  Shield,
  Smartphone,
  Globe,
  Info,
  Users,
  UserMinus,
  Plus,
  ShieldCheck,
  Zap,
  Mail,
  MailOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import { NostrProfile, Message, Conversation, DEFAULT_RELAYS, DEFAULT_DM_RELAYS, KIND_DM_RELAYS, formatNpub, parseNpub, LoginMethod } from './types';
import ProfileCard from './components/ProfileCard';

// NIP-17 constants
const KIND_DM = 14;
const KIND_SEAL = 13;
const KIND_GIFT_WRAP = 1059;

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: any): Promise<any>;
    };
  }
}

export default function App() {
  const [loginMethod, setLoginMethod] = useState<LoginMethod | null>(null);
  const [privKey, setPrivKey] = useState<Uint8Array | null>(null);
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const activeChatRef = useRef<string | null>(null);

  useEffect(() => {
    activeChatRef.current = activeChat;
    if (activeChat) {
      setConversations(prev => prev.map(c => 
        c.pubkey === activeChat ? { ...c, unreadCount: 0 } : c
      ));
    }
  }, [activeChat]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{pubkey: string, profile: NostrProfile}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [bunkerUrl, setBunkerUrl] = useState('');
  const [showBunkerInput, setShowBunkerInput] = useState(false);
  const [viewingProfile, setViewingProfile] = useState<{pubkey: string, profile?: NostrProfile} | null>(null);
  const [following, setFollowing] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [userDmRelays, setUserDmRelays] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showRelayNotice, setShowRelayNotice] = useState(false);
  const [powDifficulty, setPowDifficulty] = useState(0);
  const [isMining, setIsMining] = useState(false);
  const [newRelay, setNewRelay] = useState('');

  const pool = useRef(new SimplePool());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const bunkerSigner = useRef<nip46.BunkerSigner | null>(null);

  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const publishWithTimeout = async (relays: string[], event: Event, timeoutMs = 5000) => {
    const pubPromises = pool.current.publish(relays, event);
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("publish timed out")), timeoutMs)
    );

    try {
      // Wait for at least one relay to succeed or timeout
      await Promise.race([
        Promise.any(pubPromises),
        timeout
      ]);
      return true;
    } catch (e) {
      console.warn("Publishing had issues (timeout or all failed), but proceeding optimistically", e);
      return false;
    }
  };

  useEffect(() => {
    const savedMethod = localStorage.getItem('pam_login_method') as LoginMethod;
    const savedKey = localStorage.getItem('pam_privkey');
    const savedBunker = localStorage.getItem('pam_bunker_url');

    if (savedMethod === 'local' && savedKey) {
      const key = new Uint8Array(savedKey.split(',').map(Number));
      loginLocal(key);
    } else if (savedMethod === 'nip07') {
      loginNip07();
    } else if (savedMethod === 'nip46' && savedBunker) {
      loginNip46(savedBunker);
    }
  }, []);

  useEffect(() => {
    if (pubKey) {
      fetchProfile(pubKey);
      fetchUserDmRelays(pubKey);
      subscribeToMessages();
      syncFollows();
    }
  }, [pubKey, loginMethod]);

  const fetchUserDmRelays = async (pk: string) => {
    const event = await pool.current.get(DEFAULT_RELAYS, {
      kinds: [KIND_DM_RELAYS],
      authors: [pk]
    });
    if (event) {
      const relays = event.tags.filter(t => t[0] === 'relay').map(t => t[1]);
      setUserDmRelays(relays);
    }
  };

  const saveDmRelays = async (relays: string[]) => {
    if (!pubKey) return;
    try {
      const eventTemplate: UnsignedEvent = {
        kind: KIND_DM_RELAYS,
        pubkey: pubKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: relays.map(r => ['relay', r]),
        content: '',
      };
      const signed = await signEvent(eventTemplate);
      await publishWithTimeout(DEFAULT_RELAYS, signed);
      setUserDmRelays(relays);
    } catch (e) {
      console.error("Failed to save DM relays", e);
      alert("Failed to save DM relays. Please try again.");
    }
  };

  const syncFollows = async () => {
    if (!pubKey) return;
    setIsSyncing(true);
    try {
      const event = await pool.current.get(DEFAULT_RELAYS, {
        kinds: [3],
        authors: [pubKey]
      });
      
      if (event) {
        const follows = event.tags
          .filter(t => t[0] === 'p')
          .map(t => t[1]);
        setFollowing(follows);
        
        // Pre-fetch some profiles for the follow list
        follows.slice(0, 20).forEach(pk => fetchProfileForConversation(pk));
      }
    } catch (e) {
      console.error("Failed to sync follows", e);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loginLocal = (key: Uint8Array, isNew = false) => {
    setPrivKey(key);
    const pub = getPublicKey(key);
    setPubKey(pub);
    setLoginMethod('local');
    localStorage.setItem('pam_login_method', 'local');
    localStorage.setItem('pam_privkey', key.toString());
    
    if (isNew) {
      setupNewUser(pub, key);
    }
  };

  const setupNewUser = async (pk: string, sk: Uint8Array) => {
    try {
      // 1. Follow self
      const followTemplate: UnsignedEvent = {
        kind: 3,
        pubkey: pk,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', pk]],
        content: '',
      };
      const signedFollow = finalizeEvent(followTemplate, sk);
      
      // 2. Set default DM relays (NIP-17)
      const relayTemplate: UnsignedEvent = {
        kind: KIND_DM_RELAYS,
        pubkey: pk,
        created_at: Math.floor(Date.now() / 1000) + 1, // Slightly later
        tags: DEFAULT_DM_RELAYS.map(r => ['relay', r]),
        content: '',
      };
      const signedRelays = finalizeEvent(relayTemplate, sk);

      await Promise.all([
        publishWithTimeout(DEFAULT_RELAYS, signedFollow),
        publishWithTimeout(DEFAULT_RELAYS, signedRelays)
      ]);

      setFollowing([pk]);
      setUserDmRelays(DEFAULT_DM_RELAYS);
      setShowRelayNotice(true);
    } catch (e) {
      console.error("Failed to setup new user", e);
    }
  };

  const toggleFollow = async (targetPk: string) => {
    if (!pubKey) return;
    const isFollowing = following.includes(targetPk);
    const newFollowing = isFollowing 
      ? following.filter(pk => pk !== targetPk)
      : [...following, targetPk];

    // Optimistic update
    setFollowing(newFollowing);

    try {
      const eventTemplate: UnsignedEvent = {
        kind: 3,
        pubkey: pubKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: newFollowing.map(pk => ['p', pk]),
        content: '',
      };
      
      const signed = await signEvent(eventTemplate);
      await publishWithTimeout(DEFAULT_RELAYS, signed);
    } catch (e) {
      console.error("Failed to update follows on relays", e);
      // Revert on hard error if necessary, but usually Nostr is fine with eventual consistency
    }
  };

  const loginNip07 = async () => {
    if (!window.nostr) {
      alert("Nostr extension not found");
      return;
    }
    try {
      const pub = await window.nostr.getPublicKey();
      setPubKey(pub);
      setLoginMethod('nip07');
      localStorage.setItem('pam_login_method', 'nip07');
    } catch (e) {
      console.error("NIP-07 login failed", e);
    }
  };

  const loginNip46 = async (url: string) => {
    setIsLoading(true);
    try {
      // Create a local key for the session if not exists
      let sessionKey = localStorage.getItem('pam_nip46_session_key');
      let sk: Uint8Array;
      if (sessionKey) {
        sk = new Uint8Array(sessionKey.split(',').map(Number));
      } else {
        sk = generateSecretKey();
        localStorage.setItem('pam_nip46_session_key', sk.toString());
      }

      const bp = await nip46.parseBunkerInput(url);
      if (!bp) throw new Error("Invalid bunker URL");

      const signer = nip46.BunkerSigner.fromBunker(sk, bp, { pool: pool.current });
      await signer.connect();
      const pub = await signer.getPublicKey();
      
      bunkerSigner.current = signer;
      setPubKey(pub);
      setLoginMethod('nip46');
      setBunkerUrl(url);
      localStorage.setItem('pam_login_method', 'nip46');
      localStorage.setItem('pam_bunker_url', url);
      setShowBunkerInput(false);
    } catch (e) {
      console.error("NIP-46 login failed", e);
      alert("Failed to connect to Nostr Bunker");
    } finally {
      setIsLoading(false);
    }
  };

  const signEvent = async (event: UnsignedEvent): Promise<Event> => {
    if (loginMethod === 'local' && privKey) {
      return finalizeEvent(event, privKey);
    } else if (loginMethod === 'nip07' && window.nostr) {
      return await window.nostr.signEvent(event);
    } else if (loginMethod === 'nip46' && bunkerSigner.current) {
      return await bunkerSigner.current.signEvent(event);
    }
    throw new Error("No login method available for signing");
  };

  const logout = () => {
    setPrivKey(null);
    setPubKey(null);
    setProfile(null);
    setConversations([]);
    setActiveChat(null);
    setMessages([]);
    setLoginMethod(null);
    setFollowing([]);
    bunkerSigner.current = null;
    localStorage.removeItem('pam_login_method');
    localStorage.removeItem('pam_privkey');
    localStorage.removeItem('pam_bunker_url');
  };

  const fetchProfile = async (pk: string) => {
    const event = await pool.current.get(DEFAULT_RELAYS, {
      kinds: [0],
      authors: [pk]
    });
    if (event) {
      try {
        setProfile(JSON.parse(event.content));
      } catch (e) {
        console.error("Failed to parse profile", e);
      }
    }
  };

  const subscribeToMessages = () => {
    if (!pubKey) return;

    // NIP-17: We listen for Kind 1059 (Gift Wrap) sent to us
    const sub = pool.current.subscribeMany(
      DEFAULT_RELAYS,
      [
        {
          kinds: [KIND_GIFT_WRAP],
          '#p': [pubKey]
        }
      ],
      {
        onevent: async (event) => {
          try {
            let dm: Event | null = null;

            // Decryption depends on login method
            if (loginMethod === 'local' && privKey) {
              const conversationKey = nip44.getConversationKey(privKey, event.pubkey);
              const sealJson = nip44.decrypt(event.content, conversationKey);
              const seal: Event = JSON.parse(sealJson);
              if (seal.kind !== KIND_SEAL) return;
              const dmJson = nip44.decrypt(seal.content, conversationKey);
              dm = JSON.parse(dmJson);
            } else if (loginMethod === 'nip07' || loginMethod === 'nip46') {
              // NIP-17 decryption for extensions/bunkers is tricky because 
              // nip44.decrypt is usually not exposed in NIP-07 yet (it's mostly nip04).
              // However, some extensions support it. 
              // For NIP-17 with NIP-07/46, we might need the extension to support nip44.decrypt.
              // If not supported, we'll have to skip or fallback.
              // For this demo, we'll assume the user might use a local key for NIP-17 
              // or that the extension will eventually support it.
              // Realistically, NIP-17 is hard without direct access to the private key for nip44.
              console.warn("NIP-17 decryption via extension/bunker is experimental");
            }

            if (!dm || dm.kind !== KIND_DM) return;

            const msg: Message = {
              id: dm.id,
              sender: dm.pubkey,
              receiver: pubKey,
              content: dm.content,
              created_at: dm.created_at,
              isSelf: dm.pubkey === pubKey
            };

            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev;
              return [...prev, msg].sort((a, b) => a.created_at - b.created_at);
            });

            updateConversations(msg);
          } catch (e) {}
        }
      }
    );

    return () => sub.close();
  };

  const updateConversations = async (msg: Message) => {
    const otherPubkey = msg.isSelf ? msg.receiver : msg.sender;
    
    setConversations(prev => {
      const existingIdx = prev.findIndex(c => c.pubkey === otherPubkey);
      const isUnread = !msg.isSelf && activeChatRef.current !== otherPubkey;
      
      if (isUnread && Notification.permission === 'granted' && document.hidden) {
        new Notification('New Message', {
          body: msg.content.length > 50 ? msg.content.slice(0, 50) + '...' : msg.content,
          icon: '/favicon.ico'
        });
      }

      const newConv: Conversation = {
        pubkey: otherPubkey,
        lastMessage: msg,
        profile: existingIdx >= 0 ? prev[existingIdx].profile : undefined,
        unreadCount: existingIdx >= 0 
          ? (isUnread ? prev[existingIdx].unreadCount + 1 : prev[existingIdx].unreadCount)
          : (isUnread ? 1 : 0)
      };

      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = newConv;
        return updated.sort((a, b) => b.lastMessage.created_at - a.lastMessage.created_at);
      } else {
        fetchProfileForConversation(otherPubkey);
        return [newConv, ...prev].sort((a, b) => b.lastMessage.created_at - a.lastMessage.created_at);
      }
    });
  };

  const fetchProfileForConversation = async (pk: string) => {
    const event = await pool.current.get(DEFAULT_RELAYS, {
      kinds: [0],
      authors: [pk]
    });
    if (event) {
      try {
        const p = JSON.parse(event.content);
        setConversations(prev => prev.map(c => c.pubkey === pk ? { ...c, profile: p } : c));
      } catch (e) {}
    }
  };

  const mineEvent = (event: UnsignedEvent, difficulty: number): UnsignedEvent => {
    if (difficulty <= 0) return event;
    
    let nonce = 0;
    const target = difficulty;
    const minedEvent = { ...event };
    if (!minedEvent.tags) minedEvent.tags = [];
    
    // Remove existing nonce tag
    minedEvent.tags = minedEvent.tags.filter(t => t[0] !== 'nonce');
    
    while (true) {
      const currentTags = [...minedEvent.tags, ['nonce', nonce.toString(), target.toString()]];
      const id = getEventHash({ ...minedEvent, tags: currentTags });
      
      if (checkDifficulty(id, target)) {
        return { ...minedEvent, tags: currentTags };
      }
      nonce++;
    }
  };

  const checkDifficulty = (id: string, difficulty: number): boolean => {
    // Each hex char is 4 bits
    const fullZeros = Math.floor(difficulty / 4);
    const remainingBits = difficulty % 4;
    
    if (id.slice(0, fullZeros) !== '0'.repeat(fullZeros)) return false;
    
    if (remainingBits > 0) {
      const nextChar = parseInt(id[fullZeros], 16);
      // difficulty 1: first bit 0 -> char < 8 (1000)
      // difficulty 2: first 2 bits 0 -> char < 4 (0100)
      // difficulty 3: first 3 bits 0 -> char < 2 (0010)
      return nextChar < Math.pow(2, 4 - remainingBits);
    }
    
    return true;
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChat || !pubKey) return;
    if (loginMethod !== 'local') {
      alert("NIP-17 sending currently requires a local key for NIP-44 encryption.");
      return;
    }

    const content = newMessage.trim();
    setNewMessage('');

    const tempId = Math.random().toString(36).substring(7);
    const msg: Message = {
      id: tempId,
      sender: pubKey,
      receiver: activeChat,
      content: content,
      created_at: Math.floor(Date.now() / 1000),
      isSelf: true
    };

    setMessages(prev => [...prev, msg].sort((a, b) => a.created_at - b.created_at));

    try {
      // Fetch recipient's DM relays
      const relayEvent = await pool.current.get(DEFAULT_RELAYS, {
        kinds: [KIND_DM_RELAYS],
        authors: [activeChat]
      });
      
      let targetRelays = DEFAULT_RELAYS;
      if (relayEvent) {
        const customRelays = relayEvent.tags.filter(t => t[0] === 'relay').map(t => t[1]);
        if (customRelays.length > 0) {
          targetRelays = customRelays;
        }
      }

      const conversationKey = nip44.getConversationKey(privKey!, activeChat);
      
      const dmTemplate: UnsignedEvent = {
        kind: KIND_DM,
        pubkey: pubKey,
        created_at: msg.created_at,
        tags: [['p', activeChat]],
        content: content,
      };
      const dm = await signEvent(dmTemplate);

      const sealTemplate: UnsignedEvent = {
        kind: KIND_SEAL,
        pubkey: pubKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: nip44.encrypt(JSON.stringify(dm), conversationKey),
      };
      const seal = await signEvent(sealTemplate);

      const giftWrapTemplate: UnsignedEvent = {
        kind: KIND_GIFT_WRAP,
        pubkey: pubKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', activeChat]],
        content: nip44.encrypt(JSON.stringify(seal), conversationKey),
      };

      let finalGiftWrapTemplate = giftWrapTemplate;
      if (powDifficulty > 0) {
        setIsMining(true);
        // Small delay to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 50));
        finalGiftWrapTemplate = mineEvent(giftWrapTemplate, powDifficulty);
        setIsMining(false);
      }

      const giftWrap = await signEvent(finalGiftWrapTemplate);

      const success = await publishWithTimeout(targetRelays, giftWrap);

      if (!success) {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, error: true } : m));
      } else {
        updateConversations(msg);
      }
    } catch (e) {
      console.error("Failed to send NIP-17 message", e);
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, error: true } : m));
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    const query = searchQuery.trim();
    
    const parsed = parseNpub(query);
    if (parsed) {
      const event = await pool.current.get(DEFAULT_RELAYS, { kinds: [0], authors: [parsed] });
      if (event) {
        try {
          setSearchResults([{ pubkey: parsed, profile: JSON.parse(event.content) }]);
        } catch (e) {}
      } else {
        setSearchResults([{ pubkey: parsed, profile: { name: 'Unknown' } }]);
      }
    } else {
      let results: {pubkey: string, profile: NostrProfile}[] = [];

      // 1. Try NIP-05 resolution if it looks like one
      if (query.includes('@')) {
        try {
          const profile = await nip05.queryProfile(query);
          if (profile) {
            const event = await pool.current.get(DEFAULT_RELAYS, { kinds: [0], authors: [profile.pubkey] });
            results.push({
              pubkey: profile.pubkey,
              profile: event ? JSON.parse(event.content) : { name: query.split('@')[0], nip05: query }
            });
          }
        } catch (e) {
          console.error("NIP-05 resolution failed", e);
        }
      }

      // 2. Search relays using NIP-50
      const events = await pool.current.querySync(DEFAULT_RELAYS, {
        kinds: [0],
        search: query,
        limit: 50
      });
      
      const relayResults = events
        .map(e => {
          try {
            return { pubkey: e.pubkey, profile: JSON.parse(e.content) as NostrProfile };
          } catch {
            return null;
          }
        })
        .filter((p): p is {pubkey: string, profile: NostrProfile} => p !== null);

      // Merge results, avoiding duplicates
      relayResults.forEach(res => {
        if (!results.find(r => r.pubkey === res.pubkey)) {
          results.push(res);
        }
      });

      // Rank by social graph (following list first)
      results.sort((a, b) => {
        const aFollowed = following.includes(a.pubkey);
        const bFollowed = following.includes(b.pubkey);
        if (aFollowed && !bFollowed) return -1;
        if (!aFollowed && bFollowed) return 1;
        return 0;
      });

      setSearchResults(results);
    }
    setIsSearching(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!pubKey) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full space-y-8 text-center"
        >
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center shadow-lg shadow-emerald-500/20 rotate-12">
              <MessageSquare className="w-10 h-10 text-black -rotate-12" />
            </div>
          </div>
          
          <div>
            <h1 className="text-5xl font-black tracking-tighter mb-2 italic">PAM</h1>
            <p className="text-zinc-400">Private, decentralized messaging via NIP-17</p>
          </div>

          <div className="space-y-3 pt-8">
            <button 
              onClick={() => loginLocal(generateSecretKey(), true)}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <Key className="w-5 h-5" />
              New Identity (Local)
            </button>

            <button 
              onClick={loginNip07}
              className="w-full py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <Globe className="w-5 h-5 text-blue-400" />
              Browser Extension (NIP-07)
            </button>

            <button 
              onClick={() => setShowBunkerInput(!showBunkerInput)}
              className="w-full py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <Shield className="w-5 h-5 text-purple-400" />
              Nostr Bunker (NIP-46)
            </button>

            <AnimatePresence>
              {showBunkerInput && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden space-y-2"
                >
                  <input 
                    type="text"
                    placeholder="bunker://... or npub@domain.com"
                    value={bunkerUrl}
                    onChange={(e) => setBunkerUrl(e.target.value)}
                    className="w-full px-4 py-3 bg-black border border-zinc-800 rounded-xl focus:outline-none focus:border-purple-500 text-sm"
                  />
                  <button 
                    onClick={() => loginNip46(bunkerUrl)}
                    disabled={isLoading}
                    className="w-full py-2 bg-purple-600 hover:bg-purple-500 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Connect to Bunker'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-800"></div>
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                <span className="bg-[#0a0a0a] px-2 text-zinc-500">Manual Import</span>
              </div>
            </div>

            <input 
              type="password"
              placeholder="Hex Private Key"
              className="w-full px-4 py-4 bg-zinc-900 border border-zinc-800 rounded-2xl focus:outline-none focus:border-emerald-500 transition-colors text-center text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value;
                  if (val.length === 64) {
                    const bytes = new Uint8Array(val.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
                    loginLocal(bytes);
                  }
                }
              }}
            />
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0a0a0a] text-white flex overflow-hidden font-sans">
      {/* Syncing Overlay */}
      <AnimatePresence>
        {isSyncing && following.length === 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center text-center p-6"
          >
            <div className="relative w-24 h-24 mb-8">
              <div className="absolute inset-0 border-4 border-emerald-500/20 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-t-emerald-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Users className="w-8 h-8 text-emerald-500" />
              </div>
            </div>
            <motion.h2 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-2xl font-bold mb-2 tracking-tight"
            >
              Syncing your network
            </motion.h2>
            <motion.p 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-zinc-500 max-w-xs text-sm"
            >
              Pam is importing your follow list and preparing your secure workspace.
            </motion.p>
            
            <div className="mt-12 flex gap-2">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                  transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
                  className="w-1.5 h-1.5 bg-emerald-500 rounded-full"
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <div className={`w-full md:w-80 border-r border-zinc-900 flex flex-col ${activeChat ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-6 border-b border-zinc-900 flex items-center justify-between">
          <div 
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => setViewingProfile({ pubkey: pubKey!, profile: profile || undefined })}
          >
            <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden border border-zinc-700 group-hover:border-emerald-500 transition-colors">
              {profile?.picture ? (
                <img src={profile.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User className="w-5 h-5 text-zinc-500" />
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-1">
                <h2 className="font-semibold text-sm truncate max-w-[100px] group-hover:text-emerald-500 transition-colors">
                  {profile?.display_name || profile?.name || 'Anonymous'}
                </h2>
                {loginMethod === 'nip07' && <Globe className="w-3 h-3 text-blue-400" />}
                {loginMethod === 'nip46' && <Shield className="w-3 h-3 text-purple-400" />}
              </div>
              <p className="text-[10px] text-zinc-500 font-mono">
                {formatNpub(pubKey!).slice(0, 12)}...
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-zinc-900 rounded-xl text-zinc-500 hover:text-emerald-400 transition-colors">
              <Settings className="w-4 h-4" />
            </button>
            <button onClick={logout} className="p-2 hover:bg-zinc-900 rounded-xl text-zinc-500 hover:text-red-400 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          <div className="flex items-center gap-2 p-1 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
            <button 
              onClick={() => setShowFollowing(false)}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${!showFollowing ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Chats
            </button>
            <button 
              onClick={() => setShowFollowing(true)}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${showFollowing ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Following
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text"
              placeholder={showFollowing ? "Filter following..." : "Search people or npub..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-10 pr-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div className="space-y-1 relative">
            {isSyncing && (
              <div className="absolute inset-0 z-20 bg-[#0a0a0a]/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-4 rounded-xl">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
                <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Syncing Follows</p>
                <p className="text-[10px] text-zinc-600 mt-1">Importing your Nostr network...</p>
              </div>
            )}

            {isSearching ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-bold px-2">Search Results</p>
                {searchResults.map(res => (
                  <button 
                    key={res.pubkey}
                    onClick={() => {
                      setViewingProfile({ pubkey: res.pubkey, profile: res.profile });
                    }}
                    className="w-full p-3 flex items-center gap-3 hover:bg-zinc-900 rounded-xl transition-colors text-left group"
                  >
                    <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden border border-zinc-700">
                      {res.profile.picture ? (
                        <img src={res.profile.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <User className="w-5 h-5 text-zinc-500" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{res.profile.display_name || res.profile.name || 'Unknown'}</p>
                        {following.includes(res.pubkey) && (
                          <span className="text-[8px] bg-emerald-500/20 text-emerald-500 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter">Following</span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500 font-mono truncate">{formatNpub(res.pubkey)}</p>
                    </div>
                  </button>
                ))}
                <button 
                  onClick={() => setSearchResults([])}
                  className="w-full py-2 text-xs text-zinc-500 hover:text-white"
                >
                  Clear search
                </button>
              </div>
            ) : showFollowing ? (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-bold px-2 mb-2">Following ({following.length})</p>
                {following.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <Users className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                    <p className="text-xs text-zinc-600">You aren't following anyone yet.</p>
                  </div>
                ) : (
                  following
                    .filter(pk => {
                      if (!searchQuery) return true;
                      const p = conversations.find(c => c.pubkey === pk)?.profile;
                      return p?.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             p?.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                             pk.toLowerCase().includes(searchQuery.toLowerCase());
                    })
                    .map(pk => {
                      const conv = conversations.find(c => c.pubkey === pk);
                      return (
                        <div 
                          key={pk}
                          className="w-full p-3 flex items-center gap-3 rounded-xl hover:bg-zinc-900 border border-transparent group transition-all"
                        >
                          <div 
                            className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden border border-zinc-700 shrink-0 cursor-pointer"
                            onClick={() => setViewingProfile({ pubkey: pk, profile: conv?.profile })}
                          >
                            {conv?.profile?.picture ? (
                              <img src={conv.profile.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <User className="w-5 h-5 text-zinc-500" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setActiveChat(pk); setShowFollowing(false); }}>
                            <p className="text-sm font-medium truncate">{conv?.profile?.display_name || conv?.profile?.name || 'Unknown'}</p>
                            <p className="text-[10px] text-zinc-500 font-mono truncate">{formatNpub(pk).slice(0, 16)}...</p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => { setActiveChat(pk); setShowFollowing(false); }}
                              className="p-2 hover:bg-emerald-500/20 text-emerald-500 rounded-lg transition-colors"
                              title="Message"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => toggleFollow(pk)}
                              className="p-2 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"
                              title="Unfollow"
                            >
                              <UserMinus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between px-2 mb-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-bold">Conversations</p>
                  {conversations.reduce((acc, c) => acc + c.unreadCount, 0) > 0 && (
                    <span className="bg-emerald-500 text-black text-[8px] font-black px-1.5 py-0.5 rounded-full">
                      {conversations.reduce((acc, c) => acc + c.unreadCount, 0)} NEW
                    </span>
                  )}
                </div>
                {conversations.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <MessageSquare className="w-8 h-8 text-zinc-800 mx-auto mb-3" />
                    <p className="text-xs text-zinc-600">No conversations yet. Search for someone to start chatting.</p>
                  </div>
                ) : (
                  conversations.map(conv => (
                    <div className="relative group/item">
                      <button 
                        key={conv.pubkey}
                        onClick={() => setActiveChat(conv.pubkey)}
                        className={`w-full p-3 flex items-center gap-3 rounded-xl transition-all text-left ${activeChat === conv.pubkey ? 'bg-emerald-500/10 border border-emerald-500/20' : 'hover:bg-zinc-900 border border-transparent'}`}
                      >
                        <div className="relative shrink-0">
                          <div className="w-10 h-10 rounded-full bg-zinc-800 overflow-hidden border border-zinc-700">
                            {conv.profile?.picture ? (
                              <img src={conv.profile.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <User className="w-5 h-5 text-zinc-500" />
                              </div>
                            )}
                          </div>
                          {conv.unreadCount > 0 && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#0a0a0a]">
                              <span className="text-[8px] font-bold text-black">{conv.unreadCount}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline">
                            <p className={`text-sm font-medium truncate ${conv.unreadCount > 0 ? 'text-white' : 'text-zinc-300'}`}>
                              {conv.profile?.display_name || conv.profile?.name || 'Unknown'}
                            </p>
                            <span className="text-[9px] text-zinc-600">{formatDistanceToNow(conv.lastMessage.created_at * 1000)}</span>
                          </div>
                          <p className={`text-xs truncate ${conv.unreadCount > 0 ? 'text-zinc-300 font-medium' : 'text-zinc-500'}`}>
                            {conv.lastMessage.content}
                          </p>
                        </div>
                      </button>
                      
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setConversations(prev => prev.map(c => 
                            c.pubkey === conv.pubkey ? { ...c, unreadCount: c.unreadCount > 0 ? 0 : 1 } : c
                          ));
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover/item:opacity-100 hover:bg-zinc-800 rounded-lg transition-all text-zinc-500 hover:text-emerald-500"
                        title={conv.unreadCount > 0 ? "Mark as Read" : "Mark as Unread"}
                      >
                        {conv.unreadCount > 0 ? <MailOpen className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-zinc-900 bg-zinc-950/50">
          <div className="flex items-center justify-between text-[10px] text-zinc-600 mb-2">
            <span>Your npub</span>
            <button 
              onClick={() => copyToClipboard(formatNpub(pubKey))}
              className="flex items-center gap-1 hover:text-emerald-500 transition-colors"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[10px] font-mono text-zinc-500 break-all bg-black/30 p-2 rounded-lg border border-zinc-900">
            {formatNpub(pubKey)}
          </p>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col bg-[#050505] ${!activeChat ? 'hidden md:flex' : 'flex'}`}>
        {activeChat ? (
          <>
            {/* Chat Header */}
            <div className="p-4 md:p-6 border-b border-zinc-900 flex items-center justify-between bg-black/20 backdrop-blur-xl sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <button onClick={() => setActiveChat(null)} className="md:hidden p-2 hover:bg-zinc-900 rounded-xl">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div 
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-zinc-800 overflow-hidden border border-zinc-700 cursor-pointer hover:border-emerald-500 transition-colors"
                  onClick={() => setViewingProfile({ 
                    pubkey: activeChat, 
                    profile: conversations.find(c => c.pubkey === activeChat)?.profile 
                  })}
                >
                  {conversations.find(c => c.pubkey === activeChat)?.profile?.picture ? (
                    <img src={conversations.find(c => c.pubkey === activeChat)!.profile!.picture} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-6 h-6 text-zinc-500" />
                    </div>
                  )}
                </div>
                <div 
                  className="cursor-pointer group"
                  onClick={() => setViewingProfile({ 
                    pubkey: activeChat, 
                    profile: conversations.find(c => c.pubkey === activeChat)?.profile 
                  })}
                >
                  <h2 className="font-bold text-lg leading-tight group-hover:text-emerald-500 transition-colors">
                    {conversations.find(c => c.pubkey === activeChat)?.profile?.display_name || 
                     conversations.find(c => c.pubkey === activeChat)?.profile?.name || 
                     'Anonymous'}
                  </h2>
                  <p className="text-[10px] text-zinc-500 font-mono">
                    {formatNpub(activeChat).slice(0, 20)}...
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setViewingProfile({ 
                    pubkey: activeChat, 
                    profile: conversations.find(c => c.pubkey === activeChat)?.profile 
                  })}
                  className="p-2 hover:bg-zinc-900 rounded-xl text-zinc-500 transition-colors"
                >
                  <Info className="w-5 h-5" />
                </button>
                <button className="p-2 hover:bg-zinc-900 rounded-xl text-zinc-500 transition-colors">
                  <Settings className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.filter(m => m.sender === activeChat || m.receiver === activeChat).length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center">
                    <MessageSquare className="w-8 h-8 text-zinc-700" />
                  </div>
                  <div>
                    <p className="text-zinc-500">No messages yet</p>
                    <p className="text-[10px] text-zinc-700">Encrypted via NIP-17</p>
                  </div>
                </div>
              ) : (
                messages
                  .filter(m => m.sender === activeChat || m.receiver === activeChat)
                  .map((msg, idx, arr) => {
                    const isLastFromUser = idx === arr.length - 1 || arr[idx+1].sender !== msg.sender;
                    return (
                      <div 
                        key={msg.id} 
                        className={`flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}
                      >
                        <div 
                          className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed relative ${
                            msg.isSelf 
                              ? 'bg-emerald-500 text-black font-medium rounded-tr-none' 
                              : 'bg-zinc-900 text-zinc-200 rounded-tl-none'
                          } ${msg.error ? 'opacity-70 border border-red-500/50' : ''}`}
                        >
                          {msg.content}
                          {msg.error && (
                            <div className="absolute -left-6 top-1/2 -translate-y-1/2 text-red-500" title="Failed to send">
                              <Info className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        {msg.error && (
                          <span className="text-[9px] text-red-500 mt-1 px-1 font-medium">
                            Failed to send. Check your relays.
                          </span>
                        )}
                        {isLastFromUser && !msg.error && (
                          <span className="text-[9px] text-zinc-600 mt-1 px-1">
                            {formatDistanceToNow(msg.created_at * 1000)} ago
                          </span>
                        )}
                      </div>
                    );
                  })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-6 border-t border-zinc-900 bg-black/20 space-y-4">
              <div className="max-w-4xl mx-auto flex flex-col gap-4">
                {/* PoW Slider */}
                <div className="flex items-center gap-4 bg-zinc-900/50 p-3 rounded-2xl border border-zinc-800/50">
                  <div className={`p-2 rounded-xl ${powDifficulty > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-800 text-zinc-600'}`}>
                    <Zap className={`w-4 h-4 ${isMining ? 'animate-pulse' : ''}`} />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Proof of Work Difficulty</span>
                      <span className={`text-xs font-mono ${powDifficulty > 0 ? 'text-emerald-500' : 'text-zinc-600'}`}>
                        {powDifficulty} bits
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="24" 
                      step="1"
                      value={powDifficulty}
                      onChange={(e) => setPowDifficulty(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>
                  {powDifficulty > 0 && (
                    <div className="text-[9px] text-zinc-600 max-w-[100px] leading-tight italic">
                      Higher difficulty helps bypass relay spam filters.
                    </div>
                  )}
                </div>

                <div className="relative flex items-center gap-3">
                  <input 
                    type="text"
                    placeholder={isMining ? "Mining Proof of Work..." : "Type a message..."}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isMining && sendMessage()}
                    disabled={isMining}
                    className="flex-1 px-6 py-4 bg-zinc-900 border border-zinc-800 rounded-2xl focus:outline-none focus:border-emerald-500 transition-colors shadow-2xl disabled:opacity-50"
                  />
                  <button 
                    onClick={sendMessage}
                    disabled={!newMessage.trim() || isMining}
                    className="p-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 text-black rounded-2xl transition-all active:scale-90 shadow-lg shadow-emerald-500/20 flex items-center justify-center min-w-[56px]"
                  >
                    {isMining ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-6">
            <div className="w-24 h-24 bg-zinc-900 rounded-[2.5rem] flex items-center justify-center rotate-6">
              <MessageSquare className="w-12 h-12 text-zinc-800 -rotate-6" />
            </div>
            <div className="max-w-xs">
              <h3 className="text-xl font-bold mb-2">Your Private Space</h3>
              <p className="text-sm text-zinc-500">Select a conversation or search for a public key to start a secure NIP-17 chat.</p>
            </div>
          </div>
        )}
      </div>

      {/* Profile Modal */}
      <AnimatePresence>
        {viewingProfile && (
          <ProfileCard 
            pubkey={viewingProfile.pubkey} 
            profile={viewingProfile.profile} 
            onClose={() => setViewingProfile(null)} 
            isFollowing={following.includes(viewingProfile.pubkey)}
            onToggleFollow={() => toggleFollow(viewingProfile.pubkey)}
            onMessage={() => {
              setActiveChat(viewingProfile.pubkey);
              setViewingProfile(null);
              setSearchResults([]);
              setSearchQuery('');
              setShowFollowing(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-950 border border-zinc-900 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-900 flex items-center justify-between">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Settings className="w-5 h-5 text-emerald-500" />
                  Settings
                </h3>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-zinc-900 rounded-xl transition-colors">
                  <ArrowLeft className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Globe className="w-4 h-4 text-zinc-500" />
                      NIP-17 DM Relays
                    </h4>
                    <div className="group relative">
                      <Info className="w-3.5 h-3.5 text-zinc-600 cursor-help" />
                      <div className="absolute right-0 bottom-full mb-2 w-64 p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-xl leading-relaxed">
                        <p className="font-bold text-zinc-200 mb-1">About DM Relays</p>
                        NIP-17 DMs are stored on specific relays. To receive messages, you must advertise which relays you use. 
                        <br/><br/>
                        <span className="text-emerald-500 font-bold">Tip:</span> Use specialized DM relays for better privacy and reliability. You can find more at <span className="text-zinc-300">nostr.watch</span> or by asking the community.
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-500 mb-4">
                    These are public relays where others will send you encrypted messages. 
                  </p>
                  
                  <div className="space-y-2 mb-4 max-h-40 overflow-y-auto pr-2">
                    {userDmRelays.length === 0 ? (
                      <div className="space-y-3">
                        <p className="text-xs text-zinc-600 italic py-2">No custom DM relays set. Using defaults:</p>
                        <div className="grid grid-cols-1 gap-2">
                          {DEFAULT_DM_RELAYS.map(r => (
                            <button 
                              key={r}
                              onClick={() => saveDmRelays([...userDmRelays, r])}
                              className="flex items-center justify-between bg-zinc-900/30 hover:bg-emerald-500/10 p-2 rounded-xl border border-zinc-800/50 transition-all group"
                            >
                              <span className="text-[10px] font-mono text-zinc-500 group-hover:text-emerald-400 truncate">{r}</span>
                              <Plus className="w-3 h-3 text-zinc-600 group-hover:text-emerald-500" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      userDmRelays.map(r => (
                        <div key={r} className="flex items-center justify-between bg-zinc-900/50 p-2 rounded-xl border border-zinc-800">
                          <span className="text-xs font-mono text-zinc-400 truncate flex-1 mr-2">{r}</span>
                          <button 
                            onClick={() => saveDmRelays(userDmRelays.filter(relay => relay !== r))}
                            className="p-1.5 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {userDmRelays.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-2">Quick Add Defaults</p>
                      <div className="flex flex-wrap gap-2">
                        {DEFAULT_RELAYS.filter(r => !userDmRelays.includes(r)).map(r => (
                          <button 
                            key={r}
                            onClick={() => saveDmRelays([...userDmRelays, r])}
                            className="text-[9px] bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-2 py-1 rounded-lg text-zinc-500 hover:text-emerald-500 transition-colors"
                          >
                            {r.replace('wss://', '')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="wss://relay.example.com"
                      value={newRelay}
                      onChange={(e) => setNewRelay(e.target.value)}
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newRelay.trim()) {
                          saveDmRelays([...userDmRelays, newRelay.trim()]);
                          setNewRelay('');
                        }
                      }}
                    />
                    <button 
                      onClick={() => {
                        if (newRelay.trim()) {
                          saveDmRelays([...userDmRelays, newRelay.trim()]);
                          setNewRelay('');
                        }
                      }}
                      className="bg-emerald-500 text-black px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-400 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-900">
                   <button 
                    onClick={() => {
                      logout();
                      setShowSettings(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 p-3 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-500/20 transition-all font-bold text-sm"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout from Pam
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Relay Notice Modal */}
      <AnimatePresence>
        {showRelayNotice && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-zinc-950 border border-zinc-800 w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl text-center space-y-6"
            >
              <div className="w-20 h-20 bg-emerald-500/10 rounded-[2rem] flex items-center justify-center mx-auto">
                <ShieldCheck className="w-10 h-10 text-emerald-500" />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-2xl font-black italic tracking-tighter">Welcome to Pam</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  We've set up your account with default DM relays so you can start receiving messages immediately.
                </p>
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-2xl text-left space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500 shrink-0 mt-0.5">
                    <Info className="w-3 h-3" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-orange-500">Public Notice</p>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      The default relays are <span className="text-zinc-200">public</span>. While your messages are end-to-end encrypted, metadata (who you talk to) is visible to relay owners.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0 mt-0.5">
                    <Globe className="w-3 h-3" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Pro Tip</p>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      For better privacy, consider using a private or specialized DM relay. You can find these on <span className="text-zinc-200">nostr.watch</span> or via community recommendations.
                    </p>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowRelayNotice(false)}
                className="w-full py-4 bg-white text-black font-black italic rounded-2xl hover:bg-zinc-200 transition-all active:scale-95"
              >
                Got it, let's go!
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
