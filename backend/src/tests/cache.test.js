import { Cache } from "../cache/cache.js";

test("creates an empty cache", () => {
    const cache = new Cache();

    expect(cache.size()).toBe(0);
});

test("stores a key", () => {
    const cache = new Cache();

    cache.set("name", "Sarvesh");

    expect(cache.size()).toBe(1);
});

test("retrieves stored value", () => {
    const cache = new Cache();

    cache.set("name", "Sarvesh");

    expect(cache.get("name")).toBe("Sarvesh");
});

test("returns undefined for missing key", () => {
    const cache = new Cache();

    expect(cache.get("xyz")).toBeUndefined();
});

test("updates existing key", () => {
    const cache = new Cache();

    cache.set("name", "Sarvesh");

    cache.set("name", "John");

    expect(cache.get("name")).toBe("John");

    expect(cache.size()).toBe(1);
});

test("deletes existing key", () => {
    const cache = new Cache();

    cache.set("name", "Sarvesh");

    cache.delete("name");

    expect(cache.get("name")).toBeUndefined();

    expect(cache.size()).toBe(0);
});

test("checks key existence", () => {
    const cache = new Cache();

    cache.set("name", "Sarvesh");

    expect(cache.has("name")).toBe(true);

    expect(cache.has("xyz")).toBe(false);
});

test("returns correct debug information", () => {
    const cache = new Cache();

    cache.set("A", 10);

    cache.set("B", 20);

    const debug = cache.debug();

    expect(debug.size).toBe(2);

    expect(debug.head).toBe("A");

    expect(debug.tail).toBe("B");
});