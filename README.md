# Universal Distributed Cache

An in-memory key-value cache that runs as a cluster. Keys are spread over cache nodes with **consistent hashing**, copied to several nodes for **replication**, expire with **TTLs**, and are evicted with **LRU** when a node fills up. A router in front handles failover, health checks, read repair, and adding or removing nodes while the cluster is running. A React dashboard shows the hash ring live.

```
                    ┌────────────────────┐
  browser ─────────▶│  frontend (nginx)  │  React dashboard
                    └─────────┬──────────┘
                              │ /cache  /cluster
                    ┌─────────▼──────────┐
  curl, apps ──────▶│       router       │  hash ring, replication, failover,
                    └──┬──────┬───────┬──┘  read repair, rebalancing, metrics
                       │      │       │
                  ┌────▼─┐ ┌──▼───┐ ┌─▼────┐
                  │cache1│ │cache2│ │cache3│  Map + doubly linked list (LRU),
                  └──────┘ └──────┘ └──────┘  TTL sweep, JSON snapshots
```

## Run it

With Docker:

```bash
docker compose up --build
```

Open **http://localhost:8080** for the dashboard. The router API is at `http://localhost:3000`, and the cache nodes are exposed on 4001–4003 for inspection.

To try scaling out, start a fourth node and add it from the dashboard's **Cluster** page (`http://cache4:4001`):

```bash
docker compose --profile scale up -d cache4
```

Without Docker (Node.js 20 or newer):

```bash
(cd cache-node && npm install) && (cd router && npm install) && (cd frontend && npm install)

# four terminals
cd cache-node && npm run dev:node1
cd cache-node && npm run dev:node2
cd cache-node && npm run dev:node3
cd router && npm start

# a fifth, for the dashboard (proxies /cache and /cluster to the router on :3000)
cd frontend && npm run dev          # http://localhost:5173
```

## What the dashboard shows

| Page | What it is for |
| --- | --- |
| **Ring** | The consistent-hash ring drawn as a dial. The outer band is coloured by which node owns each stretch, dots are cached keys placed by their hash. Type a key and it draws where the key lands and the clockwise walk to its primary and replicas. Below: per-node memory, hit rate, evictions, ring share, a reads-over-time chart and the latest requests. |
| **Keys** | Every key, which nodes hold copies (missing copies are flagged), and a live expiry countdown. A side panel reads the value without disturbing LRU order. |
| **Console** | Store, get, peek, check and delete keys, with each request shown as a curl command. Generate sample keys and read traffic, or flush the cluster. |
| **Cluster** | Each node's eviction order (the keys that would be evicted next), adding and removing nodes, manual rebalance, and router latency percentiles. |

## How it works

**Placement.** Each node owns 100 virtual points on a ring of SHA-256 positions. A key hashes to a point; the first virtual node clockwise owns it, and the next *distinct* nodes along the walk hold its replicas. Adding a node only takes over the arcs next to its own points, so most keys stay where they are (tested: far fewer than half move).

**Writes.** The router walks the key's preference list (healthy nodes first, in ring order) and writes to the first node that accepts. It then writes to the next `REPLICATION_FACTOR - 1` nodes in parallel. The write succeeds if that first node accepts it. Replica outcomes are reported in the response, not required.

**Reads.** The router asks up to `REPLICATION_FACTOR` reachable nodes in order and stops at the first hit. A miss therefore costs at most that many node lookups, not one per node. If an earlier owner missed but a later one hit, the router copies the value back to the owner that missed, with the remaining TTL (**read repair**).

**Failure handling.** An active check pings every node every few seconds, and failed requests count too. A node that fails repeatedly is skipped until a probe succeeds again. If a node that should own a key is down and the key isn't found elsewhere, the router answers `503` rather than a misleading `404`.

**Membership.** `POST /cluster/nodes` probes the new node, adds it to the ring, then **rebalances**: it reads every node's entries, copies keys to the owners that are missing them (keeping remaining TTLs), and only afterwards deletes surplus copies. A key whose copy fails is left where it was, so a partial failure never loses data. Removing a node drains it the same way before dropping it.

**Cache node.** A `Map` for lookup plus a doubly linked list ordered by recency, so get, set and eviction are O(1). TTLs are checked on read and by a periodic sweep. Values are size-limited, and an optional snapshot file is written atomically every few seconds and restored on start.

**Inspecting without side effects.** `GET /cache/:key?peek=true` returns a value without touching LRU order or hit/miss counters, so looking at the cache doesn't change what it evicts.

## API

All paths are on the router. Keys are URL encoded. Values are any JSON. `ttl` is in milliseconds.

| Method and path | Purpose |
| --- | --- |
| `POST /cache` | Store `{ "key", "value", "ttl"? }`. Returns the primary and replica outcomes. |
| `GET /cache/:key` | Read a key. Adds `servedBy` and `expiresAt`. `?peek=true` skips LRU and counters. |
| `GET /cache/has/:key` | Does any node hold it. |
| `DELETE /cache/delete/:key` | Delete from the replica set. |
| `DELETE /cache` | Flush every node. |
| `GET /cache/keys?q=&limit=` | Merged key list with `nodes`, `owners`, `position` and `underReplicated`. |
| `GET /cache/locate/:key` | Hash, ring position, and the owner walk for any key. |
| `GET /cache/health` | Per-node health, latency and failure state. |
| `GET /cache/stats`, `/cache/cache-size`, `/cache/debug?limit=` | Per-node figures and LRU order. |
| `GET /cluster/ring` | Every virtual point and each node's share of the ring. |
| `GET /cluster/metrics` | Router-measured hit rate, latency percentiles, throughput, recent requests, repair and rebalance counters. |
| `POST /cluster/nodes` | Add `{ "url" }` and rebalance. |
| `DELETE /cluster/nodes?url=` | Drain and remove a node. |
| `POST /cluster/rebalance` | Rebalance now. |

```bash
curl -X POST localhost:3000/cache -H 'Content-Type: application/json' \
  -d '{"key":"user:42","value":{"name":"Ada"},"ttl":60000}'
curl localhost:3000/cache/user%3A42
curl localhost:3000/cache/locate/user%3A42
```

## Configuration

**Cache node** (`cache-node/.env.example`)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4001` | HTTP port. |
| `CACHE_CAPACITY` | `10000` | Maximum keys; inserting beyond it evicts the least recently used. |
| `MAX_VALUE_BYTES` | `1048576` | Largest serialized value. |
| `CLEANUP_INTERVAL_MS` | `5000` | Expiry sweep interval. |
| `PERSISTENCE_FILE` | `./data/cache-<PORT>.json` | Snapshot file. Empty string disables snapshots. |
| `PERSIST_INTERVAL_MS` | `5000` | Snapshot interval. |

**Router** (`router/.env.example`)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `CACHE_NODES` | `http://localhost:4001` | Comma-separated node URLs at start-up. |
| `REPLICATION_FACTOR` | `1` | Copies per key, capped at the node count. |
| `VIRTUAL_NODES` | `100` | Ring points per node. |
| `NODE_TIMEOUT_MS` | `1500` | Per-request timeout to a node. |
| `HEALTH_INTERVAL_MS` | `3000` | Active health check interval. |

## Tests

```bash
cd cache-node && npm test     # Jest: LRU, TTL, stats, peek, HTTP API
cd router && npm test         # node:test: ring, metrics, rebalancing, failover, read repair, membership
cd frontend && npm run build
```

Router logic is written against an injected HTTP client, so the cluster tests run against in-memory fake nodes with no network. They cover failover, read repair, rebalancing that never drops data when a copy fails, and a ring where adding a node moves only the keys it takes over.

## Limits, on purpose

This is a learning project, and it is honest about what it does not do.

- **No consistency guarantees.** Replica writes are best effort, there are no version vectors, and concurrent writers to one key race. When replicas disagree, rebalancing keeps the copy held by the earliest owner on the ring.
- **No hinted handoff.** A write that failed over to another node isn't moved back until a read or rebalance restores it. A delete sent while a replica is down can later be undone by that replica.
- **Membership is in memory.** Nodes added at runtime are forgotten when the router restarts; it falls back to `CACHE_NODES`. There is one router, so it is a single point of failure.
- **Snapshots are not a log.** A crash can lose the last few seconds of writes.
- **No authentication or TLS.** Don't expose it.

## Layout

```text
cache-node/   Express API, LRU + TTL engine, snapshots
router/       Hash ring, ClusterService (failover, repair, rebalance), metrics, HTTP layer
frontend/     React dashboard (plain CSS, no UI framework)
docker-compose.yml
```
