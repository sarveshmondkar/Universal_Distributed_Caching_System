class Node {
  constructor(key, data) {
    this.key = key;
    this.value = data.value;
    this.expiresAt = data.expiresAt;

    this.prev = null;
    this.next = null;
  }
}

class DoublyLinkedList {
  constructor() {
    this.head = null;
    this.tail = null;
  }

  append(node) {
    //only executes first time when the head and tail are null;
    if (!this.head) {
      this.head = node;
      this.tail = node;
      return;
    }
    //this.tail = previous node(A)
    this.tail.next = node;
    node.prev = this.tail;
    this.tail = node;
  }

  remove(node) {
    //previous node exists
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      //if node is head
      this.head = node.next;
      if (this.head) {
        this.head.prev = null;
      }
    }

    //next node exists
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      //if node is tail
      this.tail = node.prev;
      if (this.tail) {
        this.tail.next = null;
      }
    }

    //this removes the node from the list as both prev and next are null
    node.prev = null;
    node.next = null;
  }

  moveToEnd(node) {
    if (node === this.tail) {
      return null;
    }
    this.remove(node);
    this.append(node);
  }

  removeHead() {
    if (!this.head) {
      return null;
    }
    const removeNode = this.head;
    this.remove(removeNode);
    return removeNode;
  }

  getOrder() {
    const order = [];

    let current = this.head;

    while (current) {
      order.push({
        key: current.key,
        value: current.value,
        expiresAt: current.expiresAt,
      });

      current = current.next;
    }

    return order;
  }
}

export { Node, DoublyLinkedList };
