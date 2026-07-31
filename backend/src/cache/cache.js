import { Node, DoublyLinkedList } from "./doublyLinkList";

export class Cache {
  constructor(cleanUpInterval=5000, capacity = 100) {
    this.store = new Map();
    this.list = new DoublyLinkedList();
    this.capacity = capacity;

    //This deletes key after the TTL(time to live) expiration
    setInterval(() => {
      this.startCleaningUp();
    }, cleanUpInterval);
  }

  set(key, data) {
    const timestamp = Date.now();

    const dataObj = {
      value: data.value,
    };

    if (data.ttl !== undefined) {
      dataObj.expiresAt = timestamp + data.ttl;
    }

    this.store.set(key, dataObj);
  }

  get(key) {
    if (!this.store.has(key)) {
      return undefined;
    }

    const dataObj = this.store.get(key);

    if (dataObj.expiresAt !== undefined) {
      if (Date.now() > dataObj.expiresAt) {
        this.store.delete(key);
        return undefined;
      }
    }

    return dataObj.value;
  }

  has(key) {
    return this.store.has(key);
  }

  delete(key) {
    return this.store.delete(key);
  }

  size() {
    return this.store.size;
  }

  startCleaningUp() {
    this.store.forEach((value, key) => {
      if (value.expiresAt !== undefined) {
        if (Date.now() > value.expiresAt) {
          this.store.delete(key);
          console.log(`Deleted expired key: ${key}`);
        }
      }
    });
  }
}
