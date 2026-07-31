import { Node, DoublyLinkedList } from "./doublyLinkList";

export class Cache {
  constructor(cleanUpInterval = 5000, capacity = 100) {
    this.store = new Map();
    this.list = new DoublyLinkedList();
    this.capacity = capacity;

    //This deletes key after the TTL(time to live) expiration
    setInterval(() => {
      this.startCleaningUp();
    }, cleanUpInterval);
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
    //if the key doesn't exists in the map
    if (!this.store.has(key)) {
      return undefined;
    }

    //get the node from the map
    const node = this.store.get(key);

    //if node ttl is expired ?
    if (node.expiresAt !== undefined) {
      if (Date.now() > node.expiresAt) {
        //remove from the map
        this.store.delete(key);

        //remove from the linkedlist too
        this.list.remove(node);

        return undefined;
      }
    }

    //move to the tail in the linkedlist
    this.list.moveToEnd(node);
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

          //remove from the map
          this.store.delete(key);

          console.log(`Deleted expired key: ${key}`);
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
}
