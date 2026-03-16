import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  User, 
  Copy, 
  Check, 
  ExternalLink, 
  Zap, 
  ShieldCheck, 
  Globe, 
  X,
  Hash,
  MessageSquare,
  UserPlus,
  UserMinus
} from 'lucide-react';
import { NostrProfile, formatNpub } from '../types';

interface ProfileCardProps {
  pubkey: string;
  profile?: NostrProfile;
  onClose: () => void;
  isFollowing?: boolean;
  onToggleFollow?: () => void;
  onMessage?: () => void;
}

export default function ProfileCard({ 
  pubkey, 
  profile, 
  onClose, 
  isFollowing, 
  onToggleFollow, 
  onMessage 
}: ProfileCardProps) {
  const [copied, setCopied] = React.useState(false);
  const npub = formatNpub(pubkey);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, y: 20, opacity: 0 }}
        className="bg-zinc-950 border border-zinc-800 w-full max-w-2xl rounded-[2.5rem] overflow-hidden shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Banner */}
        <div className="h-48 w-full bg-zinc-900 relative overflow-hidden">
          {profile?.banner ? (
            <img 
              src={profile.banner} 
              alt="" 
              className="w-full h-full object-cover opacity-60"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-emerald-500/20 to-purple-500/20" />
          )}
          
          {/* Close Button */}
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white/80 transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Profile Content */}
        <div className="px-8 pb-8 -mt-16 relative">
          <div className="flex flex-col md:flex-row md:items-end gap-6 mb-8">
            {/* Avatar */}
            <motion.div 
              initial={{ rotate: -10, scale: 0.8 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: 'spring', damping: 12 }}
              className="w-32 h-32 rounded-[2rem] bg-zinc-950 border-4 border-zinc-950 overflow-hidden shadow-xl"
            >
              {profile?.picture ? (
                <img 
                  src={profile.picture} 
                  alt="" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                  <User className="w-12 h-12 text-zinc-700" />
                </div>
              )}
            </motion.div>

            {/* Basic Info */}
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-3xl font-black tracking-tighter italic">
                  {profile?.display_name || profile?.name || 'Anonymous'}
                </h2>
                {profile?.nip05 && (
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
                    <ShieldCheck className="w-3 h-3" />
                    Verified
                  </div>
                )}
              </div>
              <p className="text-zinc-500 text-sm font-medium">@{profile?.name || 'unknown'}</p>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {onMessage && (
                <button 
                  onClick={onMessage}
                  className="p-4 bg-emerald-500 hover:bg-emerald-400 text-black rounded-2xl transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                  title="Message"
                >
                  <MessageSquare className="w-5 h-5" />
                </button>
              )}
              {onToggleFollow && (
                <button 
                  onClick={onToggleFollow}
                  className={`p-4 rounded-2xl transition-all active:scale-95 border ${
                    isFollowing 
                      ? 'bg-zinc-900 border-zinc-800 text-red-500 hover:bg-red-500/10 hover:border-red-500/20' 
                      : 'bg-white border-white text-black hover:bg-zinc-200'
                  }`}
                  title={isFollowing ? 'Unfollow' : 'Follow'}
                >
                  {isFollowing ? <UserMinus className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
                </button>
              )}
            </div>
          </div>

          {/* Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* About Section - Large */}
            <div className="md:col-span-2 bg-zinc-900/50 border border-zinc-800/50 p-6 rounded-[2rem] space-y-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">About</h3>
              <p className="text-sm text-zinc-300 leading-relaxed italic font-serif">
                {profile?.about || "This user hasn't shared anything about themselves yet."}
              </p>
            </div>

            {/* Stats/Quick Info */}
            <div className="space-y-4">
              {/* NIP-05 */}
              {profile?.nip05 && (
                <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-2xl flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-zinc-600 font-bold uppercase">Identity</p>
                    <p className="text-xs text-zinc-300 truncate">{profile.nip05}</p>
                  </div>
                </div>
              )}

              {/* Lightning */}
              {profile?.lud16 && (
                <div className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-2xl flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-zinc-600 font-bold uppercase">Lightning</p>
                    <p className="text-xs text-zinc-300 truncate">{profile.lud16}</p>
                  </div>
                </div>
              )}

              {/* Website */}
              {profile?.website && (
                <a 
                  href={profile.website} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="bg-zinc-900/50 border border-zinc-800/50 p-4 rounded-2xl flex items-center gap-3 hover:bg-zinc-800 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                    <ExternalLink className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-zinc-600 font-bold uppercase">Website</p>
                    <p className="text-xs text-zinc-300 truncate group-hover:text-blue-400">Visit Site</p>
                  </div>
                </a>
              )}
            </div>
          </div>

          {/* Public Key Footer */}
          <div className="mt-8 pt-6 border-t border-zinc-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-zinc-500">
              <Hash className="w-4 h-4" />
              <span className="text-[10px] font-mono break-all md:max-w-xs truncate">
                {npub}
              </span>
            </div>
            <button 
              onClick={() => copyToClipboard(npub)}
              className="px-6 py-2 bg-white text-black text-xs font-bold rounded-full hover:bg-zinc-200 transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy npub'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
