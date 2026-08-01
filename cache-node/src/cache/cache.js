import { Node, DoublyLinkedList } from "./doublyLinkedList.js";

export class Cache {
  constructor(cleanUpInterval = 5000, capacity = 100) {
    this.store = new Map();
    this.list = new DoublyLinkedList();
    this.capacity = capacity;

    //stats
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expiredKeys: 0,
      totalRequests: 0,
    };

    //This deletes key after the TTL(time to live) expiration
    this.cleanupTimer = setInterval(() => {
      this.startCleaningUp();
    }, cleanUpInterval);

    this.cleanupTimer.unref();
  }

  set(key, value, ttl) {
    const timestamp = Date.now();

    let expiresAt;

    if (ttl !== undefined) {
      expiresAt = timestamp + ttl;
    }

    //if node is present
    if (this.store.has(key)) {
      //get the node from the map
      const nodeToUpdate = this.store.get(key);

      //update the values
      nodeToUpdate.value = value;
      nodeToUpdate.expiresAt = expiresAt;

      //update to linkedList
      this.list.moveToEnd(nodeToUpdate);
      return;
    }

    //if size is map size is full
    if (this.store.size >= this.capacity) {
      //remove head from list
      const removedNode = this.list.removeHead();

      //stats updation: lru eviction
      this.stats.evictions++;

      // remove from the map as well
      this.store.delete(removedNode.key);
    }

    //create a new node
    const node = new Node(key, {
      value,
      expiresAt,
    });

    //append the node in the linkedList
    this.list.append(node);

    //add the node in the map
    this.store.set(key, node);
  }

  get(key) {
    //stats updation: totalrequest
    this.stats.totalRequests++;

    //if the key doesn't exists in the map
    if (!this.store.has(key)) {
      //stats updation: missed req
      this.stats.misses++;
      return undefined;
    }

    //get the node from the map
    const node = this.store.get(key);

    //if node ttl is expired ?
    if (node.expiresAt !== undefined) {
      if (Date.now() > node.expiresAt) {
        //stats updation: expired keys , missed req
        this.stats.expiredKeys++;
        this.stats.misses++;

        //remove from the map
        this.store.delete(key);

        //remove from the linkedlist too
        this.list.remove(node);

        return undefined;
      }
    }

    //move to the tail in the linkedlist
    this.list.moveToEnd(node);

    //stats updation: hits
    this.stats.hits++;

    return node.value;
  }

  has(key) {
    const node = this.store.get(key);

    if (!node) {
      return false;
    }

    if (node.expiresAt !== undefined && Date.now() > node.expiresAt) {
      this.list.remove(node);
      this.store.delete(key);
      return false;
    }

    return true;
  }

  delete(key) {
    const node = this.store.get(key);

    if (!node) {
      return false;
    }

    this.list.remove(node);
    this.store.delete(key);

    return true;
  }

  size() {
    return this.store.size;
  }

  startCleaningUp() {
    this.store.forEach((node, key) => {
      if (node.expiresAt !== undefined) {
        if (Date.now() > node.expiresAt) {
          //remove the node form the linkedlist
          this.list.remove(node);

          //stats updation: expired keys
          this.stats.expiredKeys++;

          //remove from the map
          this.store.delete(key);

        }
      }
    });
  }

  debug() {
    return {
      size: this.store.size,
      capacity: this.capacity,
      head: this.list.head?.key ?? null,
      tail: this.list.tail?.key ?? null,
      order: this.list.getOrder(),
    };
  }

  getStats() {
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      totalRequests: this.stats.totalRequests,
      evictions: this.stats.evictions,
      expiredKeys: this.stats.expiredKeys,
      currentSize: this.store.size,
      capacity: this.capacity,
      hitRatio:
        this.stats.totalRequests === 0
          ? "0%"
          : ((this.stats.hits / this.stats.totalRequests) * 100).toFixed(2) +
            "%",
    };
  }
}
