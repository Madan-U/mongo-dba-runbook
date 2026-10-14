# Standard Operating Procedure
## MongoDB Binary Upgrade — In-Place Replacement

| Field | Detail |
|---|---|
| **Document ID** | DBA-SOP-MDB-001 |
| **Version** | 1.0 |
| **Status** | Draft |
| **Author** | Madan U |
| **Platform** | RHEL 8.x |
| **MongoDB Version** | 8.0.x |
| **Last Revised** | — |
| **Approved By** | — |

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Audience](#2-audience)
3. [Definitions](#3-definitions)
4. [Environment Variables](#4-environment-variables)
5. [Pre-Upgrade Prerequisites](#5-pre-upgrade-prerequisites)
6. [Phase 1 — Pre-Upgrade Checks](#phase-1--pre-upgrade-checks)
7. [Phase 2 — Backup and State Capture](#phase-2--backup-and-state-capture)
8. [Phase 3 — Tarball and Binary Integrity Verification](#phase-3--tarball-and-binary-integrity-verification)
9. [Phase 4 — Stage New Binaries](#phase-4--stage-new-binaries)
10. [Phase 5 — Graceful Shutdown and Upgrade](#phase-5--graceful-shutdown-and-upgrade)
11. [Phase 6 — Post-Upgrade Verification](#phase-6--post-upgrade-verification)
12. [Rollback Procedure](#rollback-procedure)
13. [Troubleshooting Reference](#troubleshooting-reference)
14. [Sign-Off Checklist](#sign-off-checklist)

---

## 1. Purpose and Scope

This SOP defines the end-to-end procedure for performing an **in-place MongoDB binary upgrade** on a single node running RHEL 8.x. It covers pre-upgrade health verification, data backup, binary integrity checks, the upgrade execution sequence, and post-upgrade validation.

**In scope:**
- Standalone MongoDB instances
- Individual replica set nodes (see note below for rolling upgrade order)
- RHEL 8.x deployments

**Out of scope:**
- Automated rolling upgrades across full replica sets
- Replica set stepdown orchestration
- Sharded cluster upgrades
- Major version upgrades (e.g. 6.x → 7.x) — consult the MongoDB major version upgrade path documentation

> **Replica Set Note:** Always upgrade in rolling fashion — upgrade **Secondaries first**, then **step down the Primary** and upgrade it last. Apply this SOP to each node individually in that order.

---

## 2. Audience

This document is intended for:
- Database Administrators responsible for MongoDB operations
- Systems Engineers performing planned maintenance
- On-call engineers following an incident-driven upgrade

**Assumed knowledge:** Linux system administration, basic MongoDB administration, replica set concepts.

---

## 3. Definitions

| Term | Meaning |
|---|---|
| **Old Home** | Directory containing the currently running binaries |
| **New Bin** | Staging directory for the extracted new-version binaries |
| **Tarball** | The `.tgz` archive downloaded from mongodb.com |
| **SHA256** | Cryptographic hash used to verify file integrity |
| **GPG** | GNU Privacy Guard signature used to verify publisher authenticity |
| **oplog** | MongoDB replication operation log |

---

## 4. Environment Variables

Define and export these variables before beginning. All subsequent commands reference them.

```bash
# ── Core paths ─────────────────────────────────────────────────────────────────
export MONGO_BASE=/<base-mount>/<app-dir>/<instance>   # Root for this instance
export MONGO_OLD_HOME=$MONGO_BASE/mongodb_home-8.0     # Current binary home
export MONGO_NEW_BIN=$MONGO_BASE/mongodb_bin           # New binary staging dir
export MONGO_CFG=$MONGO_BASE/cfg                       # Isolated config dir
export MONGO_LOG=$MONGO_BASE/log                       # Log directory
export MONGO_DATA=$MONGO_BASE/data                     # Data directory
export MONGO_BACKUP=$MONGO_BASE/backup                 # Backup root
export MONGO_OWNER=<os-user>:<os-group>                # Process owner

# ── Tarball details ─────────────────────────────────────────────────────────────
export MONGO_TARBALL=$MONGO_BASE/mongodb-linux-x86_64-rhel8-<version>.tgz
export MONGO_VERSION=<new-version>                     # e.g. 8.0.4
export MONGO_PORT=<port>                               # Listener port

# ── Snapshot timestamp (set once at start of session) ──────────────────────────
export TS=$(date +%Y%m%d_%H%M%S)
```

Verify all paths resolve correctly before proceeding:

```bash
echo "BASE       : $MONGO_BASE"
echo "OLD HOME   : $MONGO_OLD_HOME"
echo "NEW BIN    : $MONGO_NEW_BIN"
echo "CONFIG DIR : $MONGO_CFG"
echo "DATA DIR   : $MONGO_DATA"
echo "LOG DIR    : $MONGO_LOG"
echo "BACKUP DIR : $MONGO_BACKUP"
echo "TIMESTAMP  : $TS"
```

---

## 5. Pre-Upgrade Prerequisites

All items in this table must be satisfied before executing any step.

| # | Requirement | How to Confirm |
|---|---|---|
| 1 | OS is RHEL 8.x | `cat /etc/os-release` |
| 2 | Existing MongoDB is healthy and running | `ps -ef \| grep mongod` |
| 3 | New tarball is present on the server | `ls -lh $MONGO_TARBALL` |
| 4 | Official SHA256 hash obtained from mongodb.com | Downloaded alongside the tarball |
| 5 | MongoDB GPG public key imported | `gpg --list-keys` shows the MongoDB key |
| 6 | Sufficient free disk space (≥ 2× binary size) | `df -h $MONGO_BASE` |
| 7 | Maintenance window approved and communicated | Change record or stakeholder confirmation |
| 8 | Rollback plan acknowledged | This document, Section 12 |

---

## Phase 1 — Pre-Upgrade Checks

These checks establish a baseline and identify any condition that should block the upgrade.

### 1.1 — OS and Kernel

```bash
# OS release
cat /etc/os-release

# Kernel version
uname -r

# System uptime and load
uptime
```

Record outputs. Confirm `VERSION_ID` matches the build target of the tarball (e.g. `rhel8`).

---

### 1.2 — System Resource Checks

```bash
# Disk space — data, log, and binary directories
df -h $MONGO_BASE $MONGO_DATA $MONGO_LOG

# Memory and swap
free -h

# Open file descriptor limits for the OS user
su - $(echo $MONGO_OWNER | cut -d: -f1) -c "ulimit -Hn && ulimit -Sn"

# System-wide open file handles
cat /proc/sys/fs/file-max
```

> **Minimum recommended ulimits for MongoDB:**
> - `nofile` (open files): ≥ 64000
> - `nproc` (processes): ≥ 64000

If limits are below threshold, do not proceed — raise them in `/etc/security/limits.conf` and confirm with the OS team before continuing.

---

### 1.3 — Verify the Running Instance

```bash
# Confirm process is running and capture PID
ps -ef | grep mongod | grep -v grep

# Confirm the current binary version
mongod --version

# Confirm which config the running process loaded
ps -ef | grep mongod | grep -v grep | awk '{for(i=1;i<=NF;i++) if($i=="--config") print $(i+1)}'
```

Record the **PID**, **current version**, and **config path**.

---

### 1.4 — MongoDB Instance Health

Connect to the running instance and capture its health state:

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  print('=== Server Version ===');
  print(db.adminCommand({ serverStatus: 1 }).version);

  print('=== Instance Uptime (seconds) ===');
  print(db.adminCommand({ serverStatus: 1 }).uptime);

  print('=== Connection Count ===');
  printjson(db.adminCommand({ serverStatus: 1 }).connections);

  print('=== Current Ops (active) ===');
  printjson(db.adminCommand({ currentOp: 1, active: true }).inprog.length);
"
```

**Do not proceed if:**
- Any long-running operations are active (threshold: > 30 seconds)
- Current connection count is anomalously high — investigate before continuing

---

### 1.5 — Replica Set Health (skip for standalone)

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  print('=== Replica Set Status ===');
  printjson(rs.status());

  print('=== Replication Lag (seconds) ===');
  var status = rs.status();
  status.members.forEach(function(m) {
    if (m.state !== 1) {
      var lag = Math.abs((new Date(status.members[0].optimeDate) - new Date(m.optimeDate)) / 1000);
      print(m.name + ' : ' + lag + 's');
    }
  });

  print('=== Oplog Window (hours) ===');
  var ol = db.getSiblingDB('local').oplog.rs;
  var first = ol.find().sort({$natural:1}).limit(1).next();
  var last  = ol.find().sort({$natural:-1}).limit(1).next();
  print(((last.ts.t - first.ts.t) / 3600).toFixed(2));
"
```

**Do not proceed if:**
- Any member is in `RECOVERING`, `DOWN`, or `UNKNOWN` state
- Replication lag exceeds **30 seconds**
- Oplog window is dangerously short (< 4 hours) — a restart could cause a secondary to go stale

---

### 1.6 — Pre-Upgrade Log Scan

Scan the current log for errors or warnings that may indicate pre-existing issues:

```bash
grep -E '"s":"E"|"s":"W"' $MONGO_LOG/mongod.log | tail -50
```

Investigate any critical errors before proceeding.

---

## Phase 2 — Backup and State Capture

> **Policy:** Always take a backup before modifying binaries. Do not skip this phase.

### 2.1 — Create the Backup Root

```bash
mkdir -p $MONGO_BACKUP/$TS/{dump,config,binaries,state}
```

---

### 2.2 — Back Up the Current Config Files

```bash
cp -vp $MONGO_OLD_HOME/mongod.conf  $MONGO_BACKUP/$TS/config/mongod.conf
cp -vp ~/.bash_profile               $MONGO_BACKUP/$TS/config/bash_profile.bak

# If systemd unit file is in use:
# cp -vp /etc/systemd/system/mongod.service $MONGO_BACKUP/$TS/config/

ls -lh $MONGO_BACKUP/$TS/config/
```

---

### 2.3 — Record Checksums of the Current Binaries

Before replacing anything, capture cryptographic hashes of the binaries currently in production.

```bash
sha256sum $MONGO_OLD_HOME/bin/mongod   > $MONGO_BACKUP/$TS/binaries/sha256_old_binaries.txt
sha256sum $MONGO_OLD_HOME/bin/mongos  >> $MONGO_BACKUP/$TS/binaries/sha256_old_binaries.txt
sha256sum $MONGO_OLD_HOME/bin/mongosh >> $MONGO_BACKUP/$TS/binaries/sha256_old_binaries.txt

cat $MONGO_BACKUP/$TS/binaries/sha256_old_binaries.txt
```

---

### 2.4 — Database Backup (mongodump)

Run `mongodump` against the running instance. This creates a logical backup of all databases.

```bash
mongodump \
  --port $MONGO_PORT \
  --out $MONGO_BACKUP/$TS/dump \
  --oplog \
  --numParallelCollections 4

# Confirm the dump completed without errors
echo "Exit code: $?"

# Summarise what was dumped
du -sh $MONGO_BACKUP/$TS/dump/
ls $MONGO_BACKUP/$TS/dump/
```

> **`--oplog`** captures a consistent point-in-time snapshot by including oplog entries generated during the dump. This is required for replica set backups.

For large datasets where `mongodump` is impractical within the maintenance window, substitute with a filesystem-level snapshot (LVM snapshot, cloud volume snapshot, etc.) taken while the instance is quiesced.

---

### 2.5 — Verify Backup Integrity

Perform a dry-run restore to confirm the dump files are valid:

```bash
mongorestore \
  --port $MONGO_PORT \
  --dir $MONGO_BACKUP/$TS/dump \
  --oplogReplay \
  --dryRun \
  --verbose 2>&1 | tail -20

echo "Dry-run exit code: $?"
```

---

### 2.6 — Capture Current Server State

Record the current instance state for later comparison:

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  var out = {
    version     : db.adminCommand({ serverStatus: 1 }).version,
    uptime      : db.adminCommand({ serverStatus: 1 }).uptime,
    connections : db.adminCommand({ serverStatus: 1 }).connections,
    featureCompatibilityVersion: db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 }).featureCompatibilityVersion
  };
  printjson(out);
" | tee $MONGO_BACKUP/$TS/state/pre_upgrade_state.json
```

---

## Phase 3 — Tarball and Binary Integrity Verification

> Never extract or run binaries whose integrity has not been confirmed.

### 3.1 — Verify SHA256 Checksum

Obtain the official `.sha256` hash file from the same MongoDB download page as the tarball.

```bash
# Method A — if the .sha256 file was downloaded alongside the tarball:
sha256sum -c ${MONGO_TARBALL}.sha256

# Method B — manual comparison:
sha256sum $MONGO_TARBALL
# Compare this output against the official hash published on mongodb.com
```

Expected output for Method A:
```
mongodb-linux-x86_64-rhel8-<version>.tgz: OK
```

**Stop immediately if the checksum fails.** The file is corrupt or has been tampered with. Re-download from a trusted source.

---

### 3.2 — Verify GPG Signature

```bash
# Import the MongoDB GPG public key (one-time, if not already present)
gpg --keyserver hkp://keyserver.ubuntu.com:80 \
    --recv-keys 4B7C549A058F8B6B

# Verify the tarball against the .sig file
gpg --verify ${MONGO_TARBALL}.sig $MONGO_TARBALL
```

Expected output:
```
gpg: Good signature from "MongoDB <packaging@mongodb.com>"
```

Proceed only on a **Good signature** result.

---

### 3.3 — Verify Tarball is Not Corrupt

```bash
tar -tzf $MONGO_TARBALL > /dev/null && echo "Tarball integrity: OK" || echo "Tarball integrity: FAILED"
```

---

### 3.4 — Extract the Tarball

```bash
cd $MONGO_BASE
tar -xf $MONGO_TARBALL

# Rename to a consistent, version-agnostic directory name
mv mongodb-linux-x86_64-rhel8-$MONGO_VERSION mongodb_bin

ls -lh $MONGO_BASE/mongodb_bin/bin/
```

---

### 3.5 — Verify Extracted Binary Integrity

Confirm the extracted binaries are not corrupted and are valid ELF executables:

```bash
# Confirm binary type
file $MONGO_NEW_BIN/bin/mongod
file $MONGO_NEW_BIN/bin/mongos

# Check dynamic library dependencies resolve correctly
ldd $MONGO_NEW_BIN/bin/mongod
ldd $MONGO_NEW_BIN/bin/mongos
```

Expected `file` output: `ELF 64-bit LSB executable, x86-64, dynamically linked`

Any `not found` entries in `ldd` output indicate missing shared libraries — resolve before continuing.

---

### 3.6 — Record SHA256 of the New Binaries

```bash
sha256sum $MONGO_NEW_BIN/bin/mongod   > $MONGO_BACKUP/$TS/binaries/sha256_new_binaries.txt
sha256sum $MONGO_NEW_BIN/bin/mongos  >> $MONGO_BACKUP/$TS/binaries/sha256_new_binaries.txt
sha256sum $MONGO_NEW_BIN/bin/mongosh >> $MONGO_BACKUP/$TS/binaries/sha256_new_binaries.txt

cat $MONGO_BACKUP/$TS/binaries/sha256_new_binaries.txt
```

Retain these hashes. They serve as the reference for future audits.

---

### 3.7 — Pre-Start Binary Version Check

Confirm the new binary reports the expected version before installing it:

```bash
$MONGO_NEW_BIN/bin/mongod --version
```

The output must match `$MONGO_VERSION`. If it does not, stop — the wrong tarball was extracted.

---

## Phase 4 — Stage New Binaries

### 4.1 — Stage an Isolated Config Directory

```bash
mkdir -p $MONGO_CFG
cp $MONGO_OLD_HOME/mongod.conf $MONGO_CFG/mongod.conf
```

Review the copied config and confirm the following values are correct:

```bash
cat $MONGO_CFG/mongod.conf
```

| Key | Expected Value |
|---|---|
| `storage.dbPath` | `$MONGO_DATA` |
| `systemLog.path` | `$MONGO_LOG/mongod.log` |
| `net.port` | `$MONGO_PORT` |
| `processManagement.fork` | `true` (if running as background daemon) |

---

### 4.2 — Copy Database Tools from the Old Home

The MongoDB server tarball ships only `mongod`, `mongos`, and `mongosh`. Copy the database tools from the existing installation to maintain a complete toolchain.

```bash
cd $MONGO_OLD_HOME/bin

for TOOL in mongosh bsondump mongodump mongoexport mongofiles mongoimport mongorestore mongostat mongotop; do
  [ -f "$TOOL" ] && cp -vp $TOOL $MONGO_NEW_BIN/bin/ || echo "WARNING: $TOOL not found in old home"
done
```

Verify all expected binaries are present:

```bash
ls -lh $MONGO_NEW_BIN/bin/
```

---

### 4.3 — Set Correct Ownership and Permissions

```bash
chown -R $MONGO_OWNER $MONGO_NEW_BIN
chmod 755 $MONGO_NEW_BIN/bin/*

# Confirm
ls -lh $MONGO_NEW_BIN/bin/ | head -5
```

---

## Phase 5 — Graceful Shutdown and Upgrade

### 5.1 — Final Pre-Shutdown Check

Confirm there are no active long-running operations before shutting down:

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  var ops = db.adminCommand({ currentOp: 1, active: true }).inprog;
  ops.forEach(function(op) {
    if (op.secs_running > 30) {
      print('WARN: Long-running op — opid: ' + op.opid + '  secs: ' + op.secs_running + '  ns: ' + op.ns);
    }
  });
  print('Total active ops: ' + ops.length);
"
```

If long-running operations exist, coordinate with the application team before proceeding.

---

### 5.2 — Graceful Shutdown

```bash
mongod --config $MONGO_OLD_HOME/mongod.conf --shutdown
```

Confirm the process has fully exited:

```bash
sleep 5
ps -ef | grep mongod | grep -v grep
```

Expected: no `mongod` process in the output.

If the process does not exit within 30 seconds:

```bash
# Check the log for shutdown progress
tail -20 $MONGO_LOG/mongod.log

# Send SIGTERM if needed (do not use SIGKILL unless absolutely necessary)
kill -SIGTERM <pid>
```

---

### 5.3 — Update PATH

```bash
# Open profile for editing
vi ~/.bash_profile
```

Update or add the following line (replacing any existing `$MONGO_OLD_HOME` reference):

```bash
export PATH=$MONGO_NEW_BIN/bin:$PATH
```

Apply the change to the current session:

```bash
source ~/.bash_profile
```

---

### 5.4 — Verify PATH Resolves to New Binary

```bash
which mongod
mongod --version
```

Both commands must reference `$MONGO_NEW_BIN/bin/mongod` and output `$MONGO_VERSION`. If the old version is still returned, the PATH was not updated correctly — re-check `~/.bash_profile`.

---

### 5.5 — Start MongoDB with the New Binary

```bash
mongod --config $MONGO_CFG/mongod.conf
```

Expected output:

```
about to fork child process, waiting until server is ready for connections.
forked process: <pid>
child process started successfully, parent exiting
```

If `mongod` returns a non-zero exit code, inspect the log immediately:

```bash
tail -50 $MONGO_LOG/mongod.log
```

---

## Phase 6 — Post-Upgrade Verification

Allow the instance 30–60 seconds to complete startup before running checks.

### 6.1 — Confirm Process is Running

```bash
ps -ef | grep mongod | grep -v grep
```

Record the new PID.

---

### 6.2 — Verify Server Version

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  print('Server version: ' + db.adminCommand({ serverStatus: 1 }).version);
"
```

Output must match `$MONGO_VERSION`.

---

### 6.3 — Full Server Status Check

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  var s = db.adminCommand({ serverStatus: 1 });
  print('Version        : ' + s.version);
  print('Uptime (s)     : ' + s.uptime);
  print('Connections    : current=' + s.connections.current + '  available=' + s.connections.available);
  print('Asserts errors : ' + s.asserts.msg + ' msg, ' + s.asserts.user + ' user');
  print('WiredTiger cache: ' + Math.round(s.wiredTiger.cache['bytes currently in the cache'] / 1024 / 1024) + ' MB used');
" 2>&1 | tee $MONGO_BACKUP/$TS/state/post_upgrade_state.json
```

---

### 6.4 — Replica Set Status (skip for standalone)

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  var status = rs.status();
  status.members.forEach(function(m) {
    print(m.name + '  state=' + m.stateStr + '  health=' + m.health);
  });
"
```

All members must show `health: 1`. The upgraded node must reach `PRIMARY` or `SECONDARY` state.

---

### 6.5 — Feature Compatibility Version

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  printjson(db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 }));
"
```

The FCV should reflect the expected version. Adjust only after all replica set members are upgraded.

---

### 6.6 — Database-Level Verification

```bash
mongosh --port $MONGO_PORT --quiet --eval "
  db.adminCommand({ listDatabases: 1 }).databases.forEach(function(d) {
    var stats = db.getSiblingDB(d.name).stats();
    print(d.name + ' : collections=' + stats.collections + '  dataSize=' + Math.round(stats.dataSize / 1024 / 1024) + 'MB');
  });
"
```

Compare collection counts and data sizes against the pre-upgrade baseline.

---

### 6.7 — Log Scan for Post-Start Errors

```bash
# Check for errors or warnings in the last 100 log lines
grep -E '"s":"E"|"s":"W"' $MONGO_LOG/mongod.log | tail -30

# Confirm the listener is accepting connections
grep -i "waiting for connections" $MONGO_LOG/mongod.log | tail -3
```

Expected confirmation line:
```
"msg":"Waiting for connections","attr":{"port":<port>,...}
```

---

### 6.8 — Verify Checksums of Running Binaries

Confirm what is on disk matches the hashes recorded during Phase 3:

```bash
sha256sum $MONGO_NEW_BIN/bin/mongod
sha256sum $MONGO_NEW_BIN/bin/mongos
sha256sum $MONGO_NEW_BIN/bin/mongosh

# Compare against recorded hashes
cat $MONGO_BACKUP/$TS/binaries/sha256_new_binaries.txt
```

All hashes must match.

---

### 6.9 — Monitor Stability (10-Minute Hold)

After completing the checks above, observe the instance for a minimum of **10 minutes** before declaring success:

```bash
# Watch log for errors in real-time
tail -f $MONGO_LOG/mongod.log | grep -E '"s":"E"|"s":"W"|"s":"I"'
```

Check that:
- No assertion errors appear in `serverStatus.asserts`
- Connection count is stable
- No unusual spike in slow query log entries

---

## Rollback Procedure

Invoke this procedure if the new binary fails to start, produces unexpected errors, or a functional regression is detected.

```bash
# Step 1 — Shut down the new binary (if running)
mongod --config $MONGO_CFG/mongod.conf --shutdown
sleep 5
ps -ef | grep mongod | grep -v grep

# Step 2 — Revert PATH in bash profile
#   Open ~/.bash_profile and change:
#     export PATH=$MONGO_NEW_BIN/bin:$PATH
#   back to:
#     export PATH=$MONGO_OLD_HOME/bin:$PATH
vi ~/.bash_profile

# Step 3 — Apply the reverted profile
source ~/.bash_profile

# Step 4 — Confirm old binary is active
which mongod
mongod --version   # Must show the previous version

# Step 5 — Restart with original config
mongod --config $MONGO_OLD_HOME/mongod.conf

# Step 6 — Confirm instance is healthy
ps -ef | grep mongod | grep -v grep
tail -20 $MONGO_LOG/mongod.log
mongosh --port $MONGO_PORT --eval "db.adminCommand({ serverStatus: 1 }).version"
```

After successful rollback, preserve the failed `$MONGO_NEW_BIN` directory for diagnostics — do not delete it until root cause has been determined.

---

## Troubleshooting Reference

| Symptom | Likely Cause | Remediation |
|---|---|---|
| `ECONNREFUSED` on `mongosh` | `mongod` still starting or wrong port | Wait 30s; check `ps` and `mongod.log` |
| `mongod --version` shows old version | PATH not updated or sourced | Re-check `~/.bash_profile`; run `source ~/.bash_profile` |
| `mongod` fails to start | Config path, `dbPath`, or log path error | Inspect `$MONGO_LOG/mongod.log` |
| `Permission denied` on data or log dirs | Ownership mismatch after extraction | Run `chown -R $MONGO_OWNER $MONGO_NEW_BIN` |
| `not found` in `ldd` output | Missing shared library | Install the required package via `yum`; then re-run `ldd` |
| SHA256 mismatch | Corrupt download or tampered file | Re-download from official source; re-verify |
| GPG signature invalid | Wrong key or tampered file | Re-import the MongoDB GPG key; re-download |
| Replication lag after restart | Normal catch-up or network issue | Monitor `rs.status()`; allow time for sync |
| FCV mismatch after upgrade | FCV not yet bumped | Do not bump FCV until all nodes are upgraded |

---

## Sign-Off Checklist

Complete this checklist at the end of the maintenance window. Retain it with the change record.

### Pre-Upgrade

- [ ] OS version confirmed against tarball build target
- [ ] Disk space, ulimits, and system resources verified
- [ ] Running instance health confirmed — no errors, no long-running ops
- [ ] Replica set status confirmed — all members healthy, lag within threshold
- [ ] Backup completed — `mongodump` succeeded with exit code 0
- [ ] Backup dry-run restore completed — no errors
- [ ] Pre-upgrade server state captured and saved
- [ ] Current binary SHA256 hashes recorded

### Binary Integrity

- [ ] Tarball SHA256 checksum verified against official hash — **OK**
- [ ] GPG signature verified — **Good signature**
- [ ] Tarball integrity confirmed (`tar -tzf`) — **OK**
- [ ] Extracted binary `file` type confirmed — ELF 64-bit
- [ ] `ldd` confirms all shared libraries resolve — **no missing entries**
- [ ] New binary version confirmed before start (`mongod --version`) — matches `$MONGO_VERSION`

### Upgrade Execution

- [ ] Config staged to isolated `$MONGO_CFG` directory and reviewed
- [ ] Database tools copied from old home to new bin directory
- [ ] Ownership and permissions set on new binary directory
- [ ] Graceful shutdown confirmed — no `mongod` process remaining
- [ ] PATH updated in `~/.bash_profile` — points to `$MONGO_NEW_BIN/bin`
- [ ] `which mongod` resolves to new binary
- [ ] `mongod` started successfully with new config

### Post-Upgrade

- [ ] Process confirmed running with new PID
- [ ] Server version confirmed via `serverStatus` — matches `$MONGO_VERSION`
- [ ] Replica set status confirmed — all members healthy
- [ ] Feature Compatibility Version checked
- [ ] Database collection counts and sizes match pre-upgrade baseline
- [ ] Log confirms `"Waiting for connections"` — no errors
- [ ] Running binary SHA256 hashes match recorded new-binary hashes
- [ ] 10-minute stability observation completed — no errors or anomalies

### Housekeeping

- [ ] Backup files retained at `$MONGO_BACKUP/$TS/`
- [ ] Old binary home (`$MONGO_OLD_HOME`) retained for rollback — not removed
- [ ] Change record updated with completion time and sign-off
- [ ] Stakeholders notified of successful completion

---

*End of Document — DBA-SOP-MDB-001 v1.0*
