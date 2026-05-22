-- Phase 1 Schema & Security Hygiene

-------------------------------------------------------------------------------
-- 1. Tables
-------------------------------------------------------------------------------

-- PROFILES
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE CHECK (char_length(username) >= 3 AND username = LOWER(username)),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- PREKEY BUNDLES (X3DH Public Keys)
CREATE TABLE public.prekey_bundles (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    identity_key TEXT NOT NULL,
    signed_prekey TEXT NOT NULL,
    spk_signature TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ONE TIME PREKEYS
CREATE TABLE public.one_time_prekeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX idx_one_time_prekeys_user_id ON public.one_time_prekeys(user_id);

-- FRIEND REQUESTS
DROP TYPE IF EXISTS friend_request_status CASCADE;
CREATE TYPE friend_request_status AS ENUM ('pending', 'accepted', 'rejected');
CREATE TABLE public.friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status friend_request_status DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(from_user_id, to_user_id)
);

-- CONTACTS (Friend list)
CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    contact_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, contact_user_id)
);

-- MESSAGE QUEUE
-- Payloads are JSONB to allow flexible schema evolution without migrations
CREATE TABLE public.message_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX idx_message_queue_recipient_id ON public.message_queue(recipient_id);

-- ENCRYPTED BACKUPS
-- Encrypted blob for 12-word recovery, stored as flexible JSONB
CREATE TABLE public.encrypted_backups (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    encrypted_blob JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-------------------------------------------------------------------------------
-- 2. Row Level Security (RLS)
-------------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prekey_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_time_prekeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encrypted_backups ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public profiles are viewable by everyone." 
    ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." 
    ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile." 
    ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Prekey Bundles Policies
CREATE POLICY "Prekey bundles are viewable by everyone." 
    ON public.prekey_bundles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own prekey bundle." 
    ON public.prekey_bundles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own prekey bundle." 
    ON public.prekey_bundles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own prekey bundle." 
    ON public.prekey_bundles FOR DELETE USING (auth.uid() = user_id);

-- One Time Prekeys Policies
CREATE POLICY "One time prekeys are viewable by everyone." 
    ON public.one_time_prekeys FOR SELECT USING (true);
CREATE POLICY "Users can insert their own one time prekeys." 
    ON public.one_time_prekeys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own one time prekeys." 
    ON public.one_time_prekeys FOR DELETE USING (auth.uid() = user_id);

-- Friend Requests Policies
CREATE POLICY "Users can view friend requests they are part of." 
    ON public.friend_requests FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);
CREATE POLICY "Users can create friend requests from themselves." 
    ON public.friend_requests FOR INSERT WITH CHECK (auth.uid() = from_user_id);
CREATE POLICY "Users can respond to friend requests sent to them." 
    ON public.friend_requests FOR UPDATE USING (auth.uid() = to_user_id);
CREATE POLICY "Users can delete friend requests they sent." 
    ON public.friend_requests FOR DELETE USING (auth.uid() = from_user_id);

-- Contacts Policies
CREATE POLICY "Users can view their own contacts." 
    ON public.contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own contacts." 
    ON public.contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own contacts." 
    ON public.contacts FOR DELETE USING (auth.uid() = user_id);

-- Message Queue Policies
CREATE POLICY "Users can read their own messages." 
    ON public.message_queue FOR SELECT USING (auth.uid() = recipient_id);
CREATE POLICY "Users can insert messages to anyone." 
    ON public.message_queue FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Users can delete their own messages." 
    ON public.message_queue FOR DELETE USING (auth.uid() = recipient_id);

-- Encrypted Backups Policies
CREATE POLICY "Users can read their own backup." 
    ON public.encrypted_backups FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own backup." 
    ON public.encrypted_backups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own backup." 
    ON public.encrypted_backups FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own backup." 
    ON public.encrypted_backups FOR DELETE USING (auth.uid() = user_id);
