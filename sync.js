import { createClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key } = import.meta.env;
export const supabase = url && key ? createClient(url, key, {
  auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true }
}) : null;
export const cloudSyncConfigured = Boolean(supabase);

function toBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

class SupabaseYjsProvider {
  constructor(noteId, user, doc, onStatus, onPresence) {
    this.noteId = noteId;
    this.user = user;
    this.doc = doc;
    this.onStatus = onStatus;
    this.onPresence = onPresence;
    this.remoteOrigin = { remote: true };
    this.connected = false;
    this.destroyed = false;
    this.writeQueue = Promise.resolve();
    this.reconnectTimer = null;
    this.topic = `note:${noteId}`;
    this.channel = null;
    this.handleUpdate = (update, origin) => {
      if (origin === this.remoteOrigin || !this.connected || this.destroyed) return;
      this.writeQueue = this.writeQueue.then(() => this.writeUpdate(update)).catch((error) => {
        this.onStatus?.(`Sync paused: ${error.message || 'connection issue'}`);
      });
    };
    doc.on('update', this.handleUpdate);
    this.ready = this.connect().catch((error) => {
      this.connected = false;
      this.onStatus?.(`Offline · ${error.message || 'changes are saved on this device'}`);
      this.scheduleReconnect();
      return false;
    });
  }

  async connect() {
    if (this.destroyed) return false;
    if (this.channel) {
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
    const { error: documentError } = await supabase.from('note_documents').upsert(
      { owner_id: this.user.id, note_id: this.noteId },
      { onConflict: 'owner_id,note_id', ignoreDuplicates: true }
    );
    if (documentError) throw documentError;

    this.channel = supabase.channel(this.topic, {
      config: { private: true, presence: { key: `${this.user.id}:${crypto.randomUUID()}` } }
    });
    this.channel
      .on('broadcast', { event: 'yjs_update' }, ({ payload }) => {
        if (!payload?.update_b64) return;
        try { Y.applyUpdate(this.doc, fromBase64(payload.update_b64), this.remoteOrigin); }
        catch (error) { this.onStatus?.(`Could not apply a synced edit: ${error.message}`); }
      })
      .on('presence', { event: 'sync' }, () => this.publishPresence())
      .on('presence', { event: 'join' }, () => this.publishPresence())
      .on('presence', { event: 'leave' }, () => this.publishPresence());

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.connected = false;
        this.onStatus?.('Offline · changes are saved on this device');
        this.scheduleReconnect();
        resolve(false);
      }, 5000);
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
          this.connected = true;
          try {
            await this.loadUpdates();
            await this.channel.track({
              user_id: this.user.id,
              name: this.user.user_metadata?.name || this.user.email?.split('@')[0] || 'You',
              color: '#78977d',
              device_id: crypto.randomUUID()
            });
            this.onStatus?.('Cloud sync connected');
            this.publishPresence();
            resolve(true);
          } catch (error) {
            this.connected = false;
            this.onStatus?.(`Offline · ${error.message || 'changes are saved on this device'}`);
            this.scheduleReconnect();
            resolve(false);
          }
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          clearTimeout(timeout);
          this.connected = false;
          this.onStatus?.('Offline · changes are saved on this device');
          this.scheduleReconnect();
          resolve(false);
        }
      });
    });
  }

  async loadUpdates() {
    const { data, error } = await supabase.from('note_updates')
      .select('update_b64')
      .eq('owner_id', this.user.id)
      .eq('note_id', this.noteId)
      .order('id', { ascending: true });
    if (error) throw error;
    const remoteDocument = new Y.Doc();
    for (const row of data || []) {
      const update = fromBase64(row.update_b64);
      Y.applyUpdate(remoteDocument, update);
      Y.applyUpdate(this.doc, update, this.remoteOrigin);
    }
    const localUpdatesMissingFromCloud = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(remoteDocument));
    remoteDocument.destroy();
    if (localUpdatesMissingFromCloud.length > 2) await this.writeUpdate(localUpdatesMissingFromCloud);
  }

  scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error) => {
        this.connected = false;
        this.onStatus?.(`Offline · ${error.message || 'changes are saved on this device'}`);
        this.scheduleReconnect();
      });
    }, 6000);
  }

  async writeUpdate(update) {
    if (!this.connected || this.destroyed) return;
    const { error } = await supabase.from('note_updates').insert({
      owner_id: this.user.id,
      note_id: this.noteId,
      update_b64: toBase64(update)
    });
    if (error) throw error;
  }

  publishPresence() {
    const states = Object.values(this.channel?.presenceState?.() || {}).flat();
    this.onPresence?.(states);
  }

  destroy() {
    this.destroyed = true;
    this.connected = false;
    clearTimeout(this.reconnectTimer);
    this.doc.off('update', this.handleUpdate);
    if (this.channel) void supabase.removeChannel(this.channel);
    this.onPresence?.([]);
  }
}

export async function createNoteSyncSession(noteId, user, { onStatus, onPresence } = {}) {
  if (!supabase || !user) return null;
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`margin:${user.id}:${noteId}`, doc);
  await persistence.whenSynced;
  const provider = new SupabaseYjsProvider(noteId, user, doc, onStatus, onPresence);
  try { await provider.ready; }
  catch (error) {
    provider.destroy();
    onStatus?.(`Offline · changes are saved on this device`);
  }
  return {
    doc,
    destroy() {
      provider.destroy();
      void persistence.destroy();
      doc.destroy();
    }
  };
}

export async function loadWorkspaceSnapshot(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('workspace_snapshots')
    .select('payload, updated_at')
    .eq('owner_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function saveWorkspaceSnapshot(userId, payload) {
  if (!supabase) return { error: null };
  const { error } = await supabase.from('workspace_snapshots').upsert({
    owner_id: userId,
    payload,
    updated_at: new Date().toISOString()
  });
  return { error };
}

export function subscribeWorkspace(userId, onChange) {
  if (!supabase) return null;
  const channel = supabase.channel(`workspace:${userId}`, { config: { private: true } });
  channel.on('broadcast', { event: 'workspace_changed' }, onChange);
  channel.subscribe();
  return channel;
}

export function notifyWorkspaceChanged(channel) {
  if (!channel) return;
  void channel.send({ type: 'broadcast', event: 'workspace_changed', payload: { updated_at: new Date().toISOString() } });
}
