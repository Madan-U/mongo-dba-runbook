```
// =============================================================================
// Runbook     : change_replica_set_priority.md
// Description : Procedure for modifying MongoDB replica set member priorities.
//               Includes pre-flight checks, step-by-step reconfiguration, and
//               post-change verification. Intended for DBAs with administrative
//               access to the Primary node.
// Warning     : Priority changes can trigger an immediate election if a higher-
//               priority node is healthy and fully synced. Schedule during a
//               low-traffic window when possible.
// Author      : Madan U
// Email       : madanu135@gmail.com
// =============================================================================
```

---

# MongoDB Replica Set — Change Member Priority

> **Warning:** A failover election can occur immediately after applying a priority change if a higher-priority node is healthy and caught up with replication data. Schedule this change during a low-traffic window when possible.

---

## Prerequisites

- Administrative access to the active Primary node via `mongosh`
- Replication lag verified across all members — target node must be healthy and fully synced

---

## Step 1 — Verify Replication Health

Connect to the Primary and confirm all members are in a healthy state with minimal lag before proceeding.

```js
rs.status();
```

Confirm:
- Target node state is `SECONDARY`
- `optimeDate` lag is within acceptable threshold (typically < 10 seconds)

---

## Step 2 — Capture the Active Configuration

```js
var cfg = rs.conf();
```

---

## Step 3 — Modify Member Priorities

Adjust priorities as required. Higher values indicate stronger preference to become Primary. A value of `0` makes a member permanently ineligible for Primary election.

```js
// Set the node at index 0 as the preferred Primary
cfg.members[0].priority = 5;

// Set the node at index 2 as a non-voting, non-primary member
cfg.members[2].priority = 0;
```

> **Reference:** Default priority is `1`. Valid range is `0` to `1000`.

---

## Step 4 — Apply the Reconfiguration

```js
rs.reconfig(cfg);
```

---

## Verification

### Check 1 — Confirm Updated Priorities

```js
rs.conf().members.forEach(member => {
    print(`Host: ${member.host} | Priority: ${member.priority} | Votes: ${member.votes}`);
});
```

### Check 2 — Confirm Cluster Health and Current Primary

```js
rs.status();
```

Confirm the expected node is now Primary and all members have returned to a healthy replication state.

---
