import { Node, DoublyLinkedList } from "./doublyLinkedList.js";

export class Cache {
  constructor(cleanUpInterval = 5000, capacity = 100, { maxValueBytes = 1024 * 1024 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new TypeError("capacity must be a positive integer");
    this.store = new Map();
    this.list = new DoublyLinkedList();
    this.capacity = capacity;
    this.maxValueBytes = maxValueBytes;
    this.stats = { hits: 0, misses: 0, evictions: 0, expiredKeys: 0, totalRequests: 0, sets: 0, deletes: 0 };
    this.startedAt = Date.now();
    this.cleanupTimer = setInterval(() => this.startCleaningUp(), cleanUpInterval);
    this.cleanupTimer.unref?.();
  }

  set(key, value, ttl) {
    if (typeof key !== "string" || !key.trim()) throw new TypeError("key must be a non-empty string");
    if (ttl !== undefined && ttl !== null && (!Number.isFinite(ttl) || ttl < 0)) throw new TypeError("ttl must be a non-negative number of milliseconds");
    const bytes = Buffer.byteLength(JSON.stringify(value) ?? "null");
    if (bytes > this.maxValueBytes) throw new RangeError(`value exceeds ${this.maxValueBytes} bytes`);
    const expiresAt = ttl === undefined || ttl === null ? undefined : Date.now() + ttl;
    this.stats.sets++;
    const existing = this.store.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = expiresAt;
      this.list.moveToEnd(existing);
      return;
    }
    while (this.store.size >= this.capacity) {
      const removed = this.list.removeHead();
      if (!removed) break;
      this.store.delete(removed.key);
      this.stats.evictions++;
    }
    const node = new Node(key, { value, expiresAt });
    this.list.append(node);
    this.store.set(key, node);
  }

  /** Read a key and count it as a hit or miss. Returns { value, expiresAt } or undefined. */
  getEntry(key) {
    this.stats.totalRequests++;
    const node = this.store.get(key);
    if (!node) { this.stats.misses++; return undefined; }
    if (node.expiresAt !== undefined && Date.now() >= node.expiresAt) {
      this._remove(node); this.stats.expiredKeys++; this.stats.misses++; return undefined;
    }
    this.list.moveToEnd(node);
    this.stats.hits++;
    return { value: node.value, expiresAt: node.expiresAt };
  }

  get(key) { return this.getEntry(key)?.value; }

  /** Inspect a key without touching LRU order or hit/miss counters. */
  peek(key) {
    const node = this.store.get(key);
    if (!node) return undefined;
    if (node.expiresAt !== undefined && Date.now() >= node.expiresAt) return undefined;
    return { value: node.value, expiresAt: node.expiresAt };
  }

  has(key) {
    const node = this.store.get(key);
    if (!node) return false;
    if (node.expiresAt !== undefined && Date.now() >= node.expiresAt) { this._remove(node); this.stats.expiredKeys++; return false; }
    return true;
  }

  delete(key) { const node = this.store.get(key); if (!node) return false; this._remove(node); this.stats.deletes++; return true; }

  /** Remove every entry. Counters are kept so the dashboard history stays continuous. */
  clear() {
    const removed = this.store.size;
    this.store.clear();
    this.list = new DoublyLinkedList();
    return removed;
  }
  _remove(node) { this.list.remove(node); this.store.delete(node.key); }
  size() { this.startCleaningUp(); return this.store.size; }

  startCleaningUp() {
    const now = Date.now();
    for (const [key, node] of this.store) {
      if (node.expiresAt !== undefined && now >= node.expiresAt) { this._remove(node); this.stats.expiredKeys++; }
    }
  }

  entries() {
    this.startCleaningUp();
    return [...this.store].map(([key, node]) => ({ key, value: node.value, expiresAt: node.expiresAt }));
  }

  listKeys() {
    this.startCleaningUp();
    return [...this.store].map(([key, node]) => ({ key, expiresAt: node.expiresAt }));
  }

  restore(entries = []) {
    const setsBefore = this.stats.sets;
    for (const entry of entries) {
      const remaining = entry.expiresAt === undefined ? undefined : entry.expiresAt - Date.now();
      if (remaining === undefined || remaining > 0) this.set(entry.key, entry.value, remaining);
    }
    this.stats.sets = setsBefore; // restoring a snapshot is not client write traffic
  }

  debug() { return { size: this.store.size, capacity: this.capacity, head: this.list.head?.key ?? null, tail: this.list.tail?.key ?? null, order: this.list.getOrder() }; }

  getStats() {
    const { hits, misses, totalRequests, evictions, expiredKeys, sets, deletes } = this.stats;
    return { hits, misses, totalRequests, evictions, expiredKeys, sets, deletes, startedAt: this.startedAt, uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000), currentSize: this.store.size, capacity: this.capacity, hitRatio: totalRequests ? `${((hits / totalRequests) * 100).toFixed(2)}%` : "0%" };
  }

  close() { clearInterval(this.cleanupTimer); }
}
