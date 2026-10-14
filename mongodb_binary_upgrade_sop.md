# Standard Operating Procedure
## MongoDB Binary Upgrade — In-Place Replacement

| Field | Detail |
|---|---|
| **Document ID** | DBA-SOP-MDB-001 |
| **Version** | 1.1 |
| **Status** | Draft |
| **Author** | Madan U |
| **Platform** | RHEL 8.x |
| **MongoDB Version** | 8.0.x |

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Audience](#2-audience)
3. [Upgrade Strategy](#3-upgrade-strategy)
4. [Definitions](#4-definitions)
5. [Environment Variables](#5-environment-variables)
6. [Pre-Upgrade Prerequisites](#6-pre-upgrade-prerequisites)
7. [Phase 1 — Pre-Upgrade Checks](#phase-1--pre-upgrade-checks)
8. [Phase 2 — Backup and State Capture](#phase-2--backup-and-state-capture)
9. [Phase 3 — Tarball and Binary Integrity Verification](#phase-3--tarball-and-binary-integrity-verification)
10. [Phase 4 — Stage New Binaries](#phase-4--stage-new-binaries)
11. [Phase 5 — Shutdown and Directory Switch](#phase-5--shutdown-and-directory-switch)
12. [Phase 6 — Start and Post-Upgrade Verification](#phase-6--start-and-post-upgrade-verification)
13. [Rollback Procedure](#rollback-procedure)
14. [Troubleshooting Reference](#troubleshooting-reference)
15. [Sign-Off Checklist](#sign-off-checklist)

---

## 1. Purpose and Scope

This SOP defines the procedure for performing an **in-place MongoDB binary upgrade** on a single node using a **directory-rename strategy**. The active binary directory name stays constant — the PATH is never modified. Old binaries are preserved under a renamed directory for immediate rollback.

**In scope:**
- Standalone MongoDB instances
- Individual replica set nodes (rolling upgrade order)
- RHEL 8.x deployments

**Out of scope:**
- Automated rolling upgrades across full replica sets
- Sharded cluster upgrades
- Major version upgrades (e.g. 6.x → 7.x) — see SOP DBA-SOP-MDB-002

> **Replica Set Note:** Always upgrade in rolling fashion — upgrade **Secondaries first**, then step down and upgrade the Primary last. Apply this SOP to each node individually in that order.

---

## 2. Audience

- Database Administrators responsible for MongoDB operations
- Systems Engineers performing planned maintenance
- On-call engineers following an incident-driven upgrade

**Assumed knowledge:** Linux system administration, basic MongoDB administration, replica set concepts.

---

## 3. Upgrade Strategy

The key principle of this procedure is that **`$MONGO_BIN` is always the active binary directory** and the PATH is never changed.

```
Before upgrade:
  $MONGO_BIN      →  current production binaries (active)

During upgrade (after shutdown):
  $MONGO_BIN      →  renamed to  $MONGO_BIN_OLD   (preserved for rollback)
  $MONGO_BIN_STAGE →  renamed to  $MONGO_BIN        (new binaries now active)

After upgrade:
  $MONGO_BIN      →  new version binaries (active)
  $MONGO_BIN_OLD  →  old version binaries (retained for rollback)
```

No changes to `~/.bash_profile` or PATH are required at any point.

---

## 4. Definitions

| Term | Meaning |
|---|---|
| `$MONGO_BIN` | The active binary directory. PATH points here permanently — never changes |
| `$MONGO_BIN_OLD` | Old binaries renamed here during the upgrade — retained for rollback |
| `$MONGO_BIN_STAGE` | Temporary directory where the new tarball is extracted and validated before the switch |
| **Tarball** | The `.tgz` archive downloaded from mongodb.com |
| **SHA256** | Cryptographic hash used to verify file integrity |
| **GPG** | GNU Privacy Guard signature used to verify publisher authenticity |
| **oplog** | MongoDB replication operation log |

---

## 5. Environment Variables

Define and export these variables before beginning. All subsequent commands reference them.

```bash
# ── Active binary directory (PATH points here — never changes) ──────────────────
export MONGO_BIN=$MONGO_BASE/mongodb_bin

# ── Directories created during this upgrade ─────────────────────────────────────
export MONGO_BIN_OLD=$MONGO_BASE/mongodb_bin_old     # Current binaries renamed here
export MONGO_BIN_STAGE=$MONGO_BASE/mongodb_bin_stage # New tarball extracted here

# ── Core paths ───────────────────────────────────────────────────────────────────
export MONGO_BASE=/<base-mount>/<app-dir>/<instance>
export MONGO_CFG=$MONGO_BASE/cfg
export MONGO_LOG=$MONGO_BASE/log
export MONGO_DATA=$MONGO_BASE/data
export MONGO_BACKUP=$MONGO_BASE/backup
export MONGO_OWNER=<os-user>:<os-group>

# ── Tarball details ───────────────────────────────────────────────────────────────
export MONGO_TARBALL=$MONGO_BASE/mongodb-linux-x86_64-rhel8-<version>.tgz
export MONGO_VERSION=<new-version>    # e.g. 8.0.4
export MONGO_PORT=<port>

# ── Session timestamp ─────────────────────────────────────────────────────────────
export TS=$(date +%Y%m%d_%H%M%S)
```

Verify before proceeding:

```bash
echo "ACTIVE BIN  : $MONGO_BIN"
echo "WILL RENAME : $MONGO_BIN  →  $MONGO_BIN_OLD"
echo "WILL RENAME : $MONGO_BIN_STAGE  →  $MONGO_BIN"
echo "DATA DIR    : $MONGO_DATA"
echo "LOG DIR     : $MONGO_LOG"
echo "BACKUP ROOT : $MONGO_BACKUP/$TS"
echo "TARBALL     : $MONGO_TARBALL"
echo "VERSION     : $MONGO_VERSION"
```

---

## 6. Pre-Upgrade Prerequisites

| # | Requirement | How to Confirm |
|---|---|---|
| 1 | OS is RHEL 8.x | `cat /etc/os-release` |
| 2 | Existing MongoDB is healthy and running | `ps -ef \| grep mongod` |
| 3 | New tarball present on the server | `ls -lh $MONGO_TARBALL` |
| 4 | Official SHA256 hash file obtained from mongodb.com | `.sha256` file present |
| 5 | MongoDB GPG public key imported | `gpg --list-keys` shows the MongoDB key |
| 6 | `$MONGO_BIN_OLD` does not already exist (would indicate a prior failed upgrade) | `ls $MONGO_BIN_OLD` returns not found |
| 7 | Sufficient free disk space (2× binary size for staging) | `df -h $MONGO_BASE` |
| 8 | Maintenance window approved and communicated | Change record |
| 9 | Rollback plan acknowledged | This document, Section 13 |

---

## Phase 1 — Pre-Upgrade Checks

---

### 1.1 — OS and Kernel

```bash
cat /etc/os-release
uptime
```

Confirm `VERSION_ID` matches the build target of the tarball (e.g. `rhel8`).

---

### 1.2 — Disk Space

```bash
df -h $MONGO_BASE $MONGO_DATA $MONGO_LOG $MONGO_BACKUP
```

| Path | Minimum Free |
|---|---|
| `$MONGO_BASE` | Space for `$MONGO_BIN_STAGE` alongside `$MONGO_BIN` |
| `$MONGO_DATA` | 20% free |
| `$MONGO_BACKUP` | Equal to `$MONGO_DATA` size |

---

### 1.3 — Verify the Running Instance

```bash
# Confirm process and capture PID
ps -ef | grep mongod | grep -v grep

# Confirm current binary version
mongod --version

# Confirm which config the running process loaded
ps -ef | grep mongod | grep -v grep | awk '{for(i=1;i<=NF;i++) if($i=="--config") print $(i+1)}'
```

Record the **PID**, **current version**, and **config path**.

---

### 1.4 — MongoDB Instance Health

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  print('=== Version ===');
  print(db.adminCommand({ serverStatus: 1 }).version);

  print('=== Uptime (s) ===');
  print(db.adminCommand({ serverStatus: 1 }).uptime);

  print('=== Connections ===');
  printjson(db.adminCommand({ serverStatus: 1 }).connections);

  print('=== Long-Running Ops (> 30s) ===');
  var ops = db.adminCommand({ currentOp: 1, active: true }).inprog
    .filter(function(op) { return op.secs_running > 30; });
  ops.forEach(function(op) {
    print('  opid=' + op.opid + '  secs=' + op.secs_running + '  ns=' + op.ns);
  });
  print('Long-running: ' + ops.length);
"
```

**Stop if long-running operations exist.** Coordinate with the application team to drain activity before continuing.

---

### 1.5 — Replica Set Health *(skip for standalone)*

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  var s = rs.status();
  s.members.forEach(function(m) {
    print(m.name + '  state=' + m.stateStr + '  health=' + m.health);
  });

  print('=== Replication Lag ===');
  var primary = s.members.filter(function(m) { return m.state === 1; })[0];
  s.members.forEach(function(m) {
    if (m.state !== 1 && primary) {
      var lag = Math.abs((new Date(primary.optimeDate) - new Date(m.optimeDate)) / 1000);
      print('  ' + m.name + ' : ' + lag.toFixed(0) + 's');
    }
  });

  print('=== Oplog Window (hours) ===');
  var ol = db.getSiblingDB('local').oplog.rs;
  var first = ol.find().sort({ \$natural: 1 }).limit(1).next();
  var last  = ol.find().sort({ \$natural:-1 }).limit(1).next();
  print(((last.ts.t - first.ts.t) / 3600).toFixed(2));
"
```

**Stop if:**
- Any member is in `RECOVERING`, `DOWN`, or `UNKNOWN` state
- Replication lag exceeds **30 seconds**
- Oplog window is less than **4 hours**

---

### 1.6 — Pre-Upgrade Log Scan

```bash
grep -E '"s":"E"|"s":"W"' $MONGO_LOG/mongod.log | tail -50
```

Investigate any critical errors before proceeding.

---

## Phase 2 — Backup and State Capture

> **Policy:** Always take a backup before modifying binaries. Do not skip this phase.

---

### 2.1 — Create Backup Directory

```bash
mkdir -p $MONGO_BACKUP/$TS/{dump,config,binaries,state}
echo "Backup root: $MONGO_BACKUP/$TS"
```

---

### 2.2 — Back Up Config Files

```bash
cp -vp $MONGO_CFG/mongod.conf   $MONGO_BACKUP/$TS/config/mongod.conf
cp -vp ~/.bash_profile          $MONGO_BACKUP/$TS/config/bash_profile.bak

ls -lh $MONGO_BACKUP/$TS/config/
```

---

### 2.3 — Capture Pre-Upgrade Server State

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  printjson({
    capturedAt    : new Date(),
    version       : db.version(),
    fcv           : db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 }).featureCompatibilityVersion,
    uptime_s      : db.adminCommand({ serverStatus: 1 }).uptime,
    connections   : db.adminCommand({ serverStatus: 1 }).connections,
    databases     : db.adminCommand({ listDatabases: 1 }).databases.map(function(d) {
                      var st = db.getSiblingDB(d.name).stats();
                      return { name: d.name, collections: st.collections, dataSizeMB: Math.round(st.dataSize / 1048576) };
                    })
  });
" | tee $MONGO_BACKUP/$TS/state/pre_upgrade_state.json
```

---

### 2.4 — Database Backup (mongodump)

```bash
mongodump \
  --port $MONGO_PORT \
  --out  $MONGO_BACKUP/$TS/dump \
  --oplog \
  --numParallelCollections 4

echo "Exit code: $?"
du -sh $MONGO_BACKUP/$TS/dump/
```

`--oplog` provides a consistent point-in-time snapshot. Required for replica set backups.

> For large datasets where `mongodump` exceeds the maintenance window, substitute with a filesystem-level snapshot (LVM / cloud volume) taken while the instance is quiesced. Record the snapshot ID in the change record.

---

### 2.5 — Validate Backup Integrity (Dry Run)

```bash
mongorestore \
  --port $MONGO_PORT \
  --dir  $MONGO_BACKUP/$TS/dump \
  --oplogReplay \
  --dryRun \
  --verbose 2>&1 | tail -20

echo "Dry-run exit code: $?"
```

**Non-zero exit code = backup is not usable. Stop and re-take the backup.**

---

## Phase 3 — Tarball and Binary Integrity Verification

> Never extract or run binaries whose integrity has not been confirmed.

---

### 3.1 — Verify SHA256 Checksum

```bash
# With .sha256 sidecar file:
sha256sum -c ${MONGO_TARBALL}.sha256

# Or manual comparison:
sha256sum $MONGO_TARBALL
# Compare against the hash published on mongodb.com
```

Expected: `OK`. **Stop on any mismatch — re-download from a trusted source.**

---

### 3.2 — Verify GPG Signature

```bash
# Import the MongoDB signing key (one-time)
gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys 4B7C549A058F8B6B

# Verify
gpg --verify ${MONGO_TARBALL}.sig $MONGO_TARBALL
```

Expected: `Good signature from "MongoDB <packaging@mongodb.com>"`

Any other result is a **hard stop**.

---

### 3.3 — Confirm Archive Is Not Corrupt

```bash
tar -tzf $MONGO_TARBALL > /dev/null && echo "Archive: OK" || echo "Archive: CORRUPT — STOP"
```

---

### 3.4 — Extract to Staging Directory

```bash
cd $MONGO_BASE
tar -xf $MONGO_TARBALL

# Rename extracted directory to the staging name
mv mongodb-linux-x86_64-rhel8-$MONGO_VERSION mongodb_bin_stage

ls -lh $MONGO_BIN_STAGE/bin/
```

---

### 3.5 — Confirm Staged Binary Version

```bash
$MONGO_BIN_STAGE/bin/mongod --version
```

Output must match `$MONGO_VERSION`. If it does not — wrong tarball extracted. **Stop.**

---

## Phase 4 — Stage New Binaries

### 4.1 — Copy Database Tools from Current Active Directory

The MongoDB server tarball ships only `mongod`, `mongos`, and `mongosh`. Copy tools from the current active installation.

```bash
cd $MONGO_BIN/bin

for TOOL in mongosh bsondump mongodump mongoexport mongofiles mongoimport mongorestore mongostat mongotop; do
  [ -f "$TOOL" ] && cp -vp $TOOL $MONGO_BIN_STAGE/bin/ || echo "WARNING: $TOOL not found"
done

ls -lh $MONGO_BIN_STAGE/bin/
```

---

### 4.2 — Set Correct Ownership and Permissions

```bash
chown -R $MONGO_OWNER $MONGO_BIN_STAGE
chmod 755 $MONGO_BIN_STAGE/bin/*
```

---

### 4.3 — Review Config

Confirm the config being used is correct — no changes needed to paths since the directory names are switching, not the config:

```bash
cat $MONGO_CFG/mongod.conf
```

| Config Key | Expected Value |
|---|---|
| `storage.dbPath` | `$MONGO_DATA` |
| `systemLog.path` | `$MONGO_LOG/mongod.log` |
| `net.port` | `$MONGO_PORT` |

---

## Phase 5 — Shutdown and Directory Switch

This is the critical section. The steps below are executed in sequence with no pause between 5.2 and 5.4.

---

### 5.1 — Final Blocking Check Before Shutdown

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  var ops = db.adminCommand({ currentOp: 1, active: true }).inprog
    .filter(function(op) { return op.secs_running > 30; });
  ops.length > 0
    ? ops.forEach(function(op) { print('BLOCKING: opid=' + op.opid + '  secs=' + op.secs_running + '  ns=' + op.ns); })
    : print('No blocking operations — safe to shutdown');
"
```

---

### 5.2 — Graceful Shutdown

```bash
mongod --config $MONGO_CFG/mongod.conf --shutdown
```

Confirm the process has exited:

```bash
sleep 5
ps -ef | grep mongod | grep -v grep
```

Expected: no `mongod` process.

> Do not use `SIGKILL`. An unclean shutdown leaves WiredTiger in an inconsistent state.

---

### 5.3 — Rename Current Active Directory to Old

```bash
mv $MONGO_BIN $MONGO_BIN_OLD

# Confirm
ls -lhd $MONGO_BIN_OLD
```

At this point `$MONGO_BIN` no longer exists. The PATH reference is temporarily broken — this is expected and intentional.

---

### 5.4 — Rename Staged Directory to Active

```bash
mv $MONGO_BIN_STAGE $MONGO_BIN

# Confirm
ls -lhd $MONGO_BIN
ls -lh $MONGO_BIN/bin/ | head -5
```

The PATH now resolves to the new version binaries. No profile change was required.

---

### 5.5 — Confirm Active Binary Is New Version

```bash
mongod --version
```

Must output `$MONGO_VERSION`. If it still shows the old version, the rename did not complete — check `ls $MONGO_BIN/bin/mongod`.

---

## Phase 6 — Start and Post-Upgrade Verification

### 6.1 — Start MongoDB

```bash
mongod --config $MONGO_CFG/mongod.conf
```

Expected output:

```
about to fork child process, waiting until server is ready for connections.
forked process: <pid>
child process started successfully, parent exiting
```

On startup failure — inspect the log immediately:

```bash
tail -50 $MONGO_LOG/mongod.log
```

---

### 6.2 — Confirm Process Is Running

```bash
ps -ef | grep mongod | grep -v grep
```

Record the new PID.

---

### 6.3 — Verify Server Version

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  print('Server version: ' + db.adminCommand({ serverStatus: 1 }).version);
"
```

Output must match `$MONGO_VERSION`.

---

### 6.4 — Full Server Status

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  var s = db.adminCommand({ serverStatus: 1 });
  print('Version      : ' + s.version);
  print('Uptime (s)   : ' + s.uptime);
  print('Connections  : current=' + s.connections.current + '  available=' + s.connections.available);
  print('Asserts.msg  : ' + s.asserts.msg);
  print('Asserts.user : ' + s.asserts.user);
  print('WT cache(MB) : ' + Math.round(s.wiredTiger.cache['bytes currently in the cache'] / 1048576));
" | tee $MONGO_BACKUP/$TS/state/post_upgrade_state.json
```

---

### 6.5 — Replica Set Health *(skip for standalone)*

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  rs.status().members.forEach(function(m) {
    print(m.name + '  state=' + m.stateStr + '  health=' + m.health);
  });
"
```

All members must show `health: 1`.

---

### 6.6 — Replication Lag *(skip for standalone)*

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  var s = rs.status();
  var p = s.members.filter(function(m) { return m.state === 1; })[0];
  s.members.forEach(function(m) {
    if (m.state !== 1 && p) {
      var lag = Math.abs((new Date(p.optimeDate) - new Date(m.optimeDate)) / 1000);
      print(m.name + ' : ' + lag.toFixed(0) + 's lag');
    }
  });
"
```

---

### 6.7 — Feature Compatibility Version

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  printjson(db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 }));
"
```

---

### 6.8 — Post-Start Log Scan

```bash
grep -E '"s":"E"' $MONGO_LOG/mongod.log | tail -30
grep -i "waiting for connections" $MONGO_LOG/mongod.log | tail -3
```

Expected: `"msg":"Waiting for connections","attr":{"port":<port>}`

---


### 6.9 — 10-Minute Stability Hold

```bash
tail -f $MONGO_LOG/mongod.log | grep -E '"s":"E"|EXCEPTION'
```

Confirm stable connections, no assertion errors, no unexpected warnings before declaring success.

---

## Rollback Procedure

Rollback is a simple directory rename reversal. No PATH changes needed.

```bash
# 1 — Shut down the new binary
mongod --config $MONGO_CFG/mongod.conf --shutdown
sleep 5
ps -ef | grep mongod | grep -v grep

# 2 — Rename current (new) active directory out of the way
mv $MONGO_BIN $MONGO_BASE/mongodb_bin_failed

# 3 — Restore old binaries as the active directory
mv $MONGO_BIN_OLD $MONGO_BIN

# 4 — Confirm old binary is active
mongod --version    # Must show the previous version

# 5 — Restart with original config
mongod --config $MONGO_CFG/mongod.conf

# 6 — Verify
sleep 10
ps -ef | grep mongod | grep -v grep
mongosh --port $MONGO_PORT --eval "db.version()"
tail -20 $MONGO_LOG/mongod.log
```

After rollback: retain `mongodb_bin_failed` for diagnostics. Raise an incident record before rescheduling the upgrade.

---

## Troubleshooting Reference

| Symptom | Likely Cause | Remediation |
|---|---|---|
| `mongod --version` shows old version after rename | Rename did not complete or wrong dir | `ls -lhd $MONGO_BIN` — confirm it points to new extract |
| `$MONGO_BIN` not found after step 5.3 | Expected — exists only after step 5.4 completes | Execute step 5.4 immediately |
| `ECONNREFUSED` on `mongosh` | `mongod` still starting or wrong port | Wait 30s; check `ps` and `mongod.log` |
| `mongod` fails to start | Config path, `dbPath`, or log path error | Inspect `$MONGO_LOG/mongod.log` |
| `Permission denied` on data or log dirs | Ownership mismatch after extraction | Run `chown -R $MONGO_OWNER $MONGO_BIN` |
| SHA256 mismatch | Corrupt download or tampered file | Re-download from official source; re-verify |
| GPG signature invalid | Wrong key or tampered file | Re-import the MongoDB GPG key; re-download |
| `$MONGO_BIN_OLD` already exists before upgrade | Prior failed upgrade not cleaned up | Investigate before proceeding — do not overwrite |
| Replication lag after restart | Normal catch-up | Monitor `rs.status()`; allow time for sync |

---

## Sign-Off Checklist

### Pre-Upgrade

- [ ] OS version confirmed against tarball build target
- [ ] Disk space meets all thresholds
- [ ] `$MONGO_BIN_OLD` confirmed not present — no prior failed upgrade
- [ ] Running instance healthy — no errors, no long-running ops
- [ ] Replica set: all members healthy, lag < 30s, oplog window ≥ 4 hours
- [ ] mongodump completed — exit code 0
- [ ] Backup dry-run restore confirmed — exit code 0
- [ ] Pre-upgrade state snapshot saved
- [ ] SHA256 of current production binaries recorded

### Binary Integrity

- [ ] Tarball SHA256 verified — **OK**
- [ ] GPG signature verified — **Good signature**
- [ ] Archive integrity confirmed — **OK**
- [ ] Staged binary version confirmed — matches `$MONGO_VERSION`
- [ ] SHA256 of new binaries recorded

### Directory Switch

- [ ] No blocking operations at time of shutdown
- [ ] Graceful shutdown confirmed — no `mongod` process
- [ ] `$MONGO_BIN` renamed to `$MONGO_BIN_OLD` — confirmed
- [ ] `$MONGO_BIN_STAGE` renamed to `$MONGO_BIN` — confirmed
- [ ] `mongod --version` shows new version

### Post-Upgrade

- [ ] Process confirmed running with new PID
- [ ] Server version = `$MONGO_VERSION`
- [ ] Replica set: all members healthy
- [ ] DB collection counts match pre-upgrade baseline
- [ ] Log confirms `Waiting for connections` — no errors
- [ ] Running binary checksums match recorded hashes
- [ ] 10-minute stability hold complete

### Housekeeping

- [ ] Backup retained at `$MONGO_BACKUP/$TS/`
- [ ] `$MONGO_BIN_OLD` retained until next maintenance window
- [ ] Change record updated with completion time and sign-off
- [ ] Stakeholders notified of successful completion

---

*End of Document — DBA-SOP-MDB-001 v1.1*
