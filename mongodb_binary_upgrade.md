```
// =============================================================================
// Runbook     : mongodb_binary_upgrade.md
// Description : Procedure for replacing MongoDB binaries in-place on a
//               standalone or replica set node (RHEL 8.x). Covers extraction,
//               directory staging, graceful shutdown, PATH update, and
//               post-start verification. Does not cover replica set stepdown
//               or rolling upgrade orchestration.
// Author      : Madan U
// Email       : madanu135@gmail.com
// Tested On   : RHEL 8.10 | MongoDB 8.0.x
// =============================================================================
```

---

# MongoDB Binary Upgrade — In-Place Replacement

> **Note:** This procedure covers a single node. For replica sets, perform a rolling upgrade — start with Secondaries, then step down and upgrade the Primary last.

---

## Environment Variables

Define these before starting. All subsequent steps reference them.

```bash
MONGO_BASE=/<base-mount>/<app-dir>/<instance>    # Base directory for this MongoDB instance
MONGO_OLD_HOME=$MONGO_BASE/mongodb_home-8.0      # Current (old) installation home
MONGO_NEW_BIN=$MONGO_BASE/mongodb_bin            # Staged new binary directory
MONGO_CFG=$MONGO_BASE/cfg                        # Isolated config directory
MONGO_TARBALL=$MONGO_BASE/<tarball>.tgz          # Downloaded release archive
MONGO_LOG=$MONGO_BASE/log                        # Log directory
MONGO_DATA=$MONGO_BASE/data                      # Data directory
MONGO_OWNER=<os-user>:<os-group>                 # OS user owning the MongoDB process
```

---

## Prerequisites

| Requirement | Details |
|---|---|
| OS | RHEL 8.x |
| Existing MongoDB | 8.0.x running and healthy |
| New tarball | Downloaded to `$MONGO_BASE` and checksum verified |
| Access | OS user ownership over `$MONGO_BASE` |
| Disk space | Ensure sufficient space for extracted binaries alongside existing installation |

---

## Step 1 — Verify the Running Instance

Confirm the existing process is healthy before making any changes.

```bash
# Check running process and PID
ps -ef | grep mongod

# Confirm current binary version
mongod --version
```

Expected: one `mongod` process running, version matches the currently deployed release.

---

## Step 2 — Check OS Version

```bash
cat /etc/os-release
```

Confirm the `VERSION_ID` matches the build target of the tarball (e.g. `rhel8`).

---

## Step 3 — Extract the New Release

```bash
cd $MONGO_BASE

# Extract tarball
tar -xf $MONGO_TARBALL

# Rename to a clean, version-agnostic directory name
mv mongodb-linux-x86_64-rhel8-<version> mongodb_bin
```

---

## Step 4 — Stage an Isolated Config Directory

Copy the active config to a standalone directory, decoupled from the old binary home.

```bash
mkdir -p $MONGO_CFG
cp $MONGO_OLD_HOME/mongod.conf $MONGO_CFG/mongod.conf
```

Review the copied config and confirm the following paths are correct before proceeding:

```bash
cat $MONGO_CFG/mongod.conf
```

| Config Key | Expected Value |
|---|---|
| `storage.dbPath` | `$MONGO_DATA` |
| `systemLog.path` | `$MONGO_LOG/mongod.log` |
| `net.port` | Configured listener port |

---

## Step 5 — Copy Utility Binaries from Old Home

The new tarball ships `mongod`, `mongos`, and `mongosh` only. Copy the database tools from the existing installation to keep the toolchain complete.

```bash
cd $MONGO_OLD_HOME/bin

cp mongosh      $MONGO_NEW_BIN/bin/
cp bsondump     $MONGO_NEW_BIN/bin/
cp mongodump    $MONGO_NEW_BIN/bin/
cp mongoexport  $MONGO_NEW_BIN/bin/
cp mongofiles   $MONGO_NEW_BIN/bin/
cp mongoimport  $MONGO_NEW_BIN/bin/
cp mongorestore $MONGO_NEW_BIN/bin/
cp mongostat    $MONGO_NEW_BIN/bin/
cp mongotop     $MONGO_NEW_BIN/bin/
```

Verify all binaries are present:

```bash
ls -lh $MONGO_NEW_BIN/bin/
```

---

## Step 6 — Set Correct Ownership

Ensure the OS user that runs `mongod` owns the new binary directory.

```bash
chown -R $MONGO_OWNER $MONGO_NEW_BIN
```

---

## Step 7 — Graceful Shutdown of the Running Instance

```bash
mongod --config $MONGO_OLD_HOME/mongod.conf --shutdown
```

Confirm the process has fully exited before proceeding:

```bash
ps -ef | grep mongod
```

Expected: no `mongod` process remaining.

---

## Step 8 — Update PATH

Edit the OS user's profile to point to the new binary directory:

```bash
vi ~/.bash_profile
```

Update or add the following line:

```bash
export PATH=$MONGO_NEW_BIN/bin:$PATH
```

Apply the change to the current session:

```bash
source ~/.bash_profile
```

---

## Step 9 — Verify the New Binary Resolves Correctly

```bash
mongod --version
```

Confirm the output reflects the new release version. If it still shows the old version, the PATH was not updated correctly — re-check `~/.bash_profile`.

---

## Step 10 — Start MongoDB with the New Binary

```bash
mongod --config $MONGO_CFG/mongod.conf
```

Expected output:

```
about to fork child process, waiting until server is ready for connections.
forked process: <pid>
child process started successfully, parent exiting
```

---

## Step 11 — Post-Start Verification

```bash
# Confirm process is running
ps -ef | grep mongod

# Connect via mongosh
mongosh

# Inside mongosh — confirm server version
db.adminCommand({ serverStatus: 1 }).version

# Check for startup errors in the log
tail -50 $MONGO_LOG/mongod.log
```

Look for the following confirmation line in the log:

```
Waiting for connections on port <port>
```

---

## Troubleshooting

| Symptom | Likely Cause | Action |
|---|---|---|
| `ECONNREFUSED` on `mongosh` | `mongod` still starting up, or wrong port | Wait a few seconds, then check `ps` and the log |
| `mongod --version` shows old version | PATH not updated or sourced | Re-check `~/.bash_profile` and run `source ~/.bash_profile` |
| `mongod` fails to start | Config path, dbPath, or log path issue | Inspect `$MONGO_LOG/mongod.log` for the error |
| Permission denied on data or log dirs | Ownership mismatch after extraction | Run `chown -R $MONGO_OWNER $MONGO_NEW_BIN` |

---

## Rollback Procedure

If the new binary fails to start or produces unexpected errors, revert as follows:

```bash
# Step 1 — Shut down the new process if running
mongod --config $MONGO_CFG/mongod.conf --shutdown

# Step 2 — Revert PATH in bash profile
vi ~/.bash_profile
# Change PATH back to: export PATH=$MONGO_OLD_HOME/bin:$PATH

# Step 3 — Apply the reverted profile
source ~/.bash_profile

# Step 4 — Confirm old binary is active
mongod --version

# Step 5 — Restart with original config
mongod --config $MONGO_OLD_HOME/mongod.conf
```

---

## Post-Upgrade Checklist

- [ ] New `mongod` process running and stable
- [ ] `mongosh` connects successfully
- [ ] Server version confirmed via `serverStatus`
- [ ] No errors in `$MONGO_LOG/mongod.log`
- [ ] `~/.bash_profile` PATH points to new binary directory
- [ ] Old binary home (`$MONGO_OLD_HOME`) retained for rollback until next maintenance window

---
