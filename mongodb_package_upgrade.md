```
// =============================================================================
// Runbook     : mongodb_package_upgrade.md
// Description : Procedure for upgrading a package-managed MongoDB installation
//               (RPM via YUM/DNF) on RHEL 8.x. Covers repository configuration,
//               service shutdown, package upgrade, and post-start verification.
//               Does not cover replica set stepdown or rolling upgrade
//               orchestration.
// Author      : Madan U
// Email       : madanu135@gmail.com
// Tested On   : RHEL 8.10 | MongoDB 8.0.x
// =============================================================================
```

---

# MongoDB Upgrade — Package Manager (YUM/DNF)

> **Note:** This procedure covers a single node. For replica sets, perform a rolling upgrade — start with Secondaries, then step down and upgrade the Primary last.

---

## Environment Variables

```bash
MONGO_VERSION=<target-version>               # e.g. 8.0.17
MONGO_MAJOR=<major-version>                  # e.g. 8.0
MONGO_CFG=<config-file-path>                 # e.g. /etc/<instance>/mongod.conf
MONGO_LOG=<log-directory>                    # Directory containing mongod.log
MONGO_DATA=<data-directory>                  # dbPath directory
MONGO_SERVICE=<systemd-service-name>         # e.g. mongod or mongod@<instance>
MONGO_REPO=/etc/yum.repos.d/mongodb-org-<major-version>.repo
```

---

## Prerequisites

| Requirement | Details |
|---|---|
| OS | RHEL 8.x |
| Existing MongoDB | Running and healthy |
| Access | `sudo` privileges on the host |
| Network | Outbound access to MongoDB repo (or local mirror configured) |
| Disk space | Sufficient space for new package downloads under `/var/cache` |

---

## Step 1 — Verify the Running Instance

```bash
# Confirm service status
sudo systemctl status $MONGO_SERVICE

# Check running process and PID
ps -ef | grep mongod

# Confirm current installed version
mongod --version
```

Expected: service is `active (running)`, version matches the currently deployed release.

---

## Step 2 — Check OS Version

```bash
cat /etc/os-release
```

Confirm `VERSION_ID` matches the target repository build (e.g. `8.10` → use `rhel80` or `rhel8` repo).

---

## Step 3 — Verify or Configure the MongoDB YUM Repository

Check if the repo is already configured:

```bash
cat $MONGO_REPO
```

If the repo file does not exist or points to an older major version, create or update it:

```bash
sudo vi $MONGO_REPO
```

```ini
[mongodb-org-<major-version>]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/8/mongodb-org/<major-version>/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://pgp.mongodb.com/server-<major-version>.asc
```

> **Air-gapped environments:** Replace `baseurl` with the URL of your internal mirror or local repository.

---

## Step 4 — Pre-Upgrade Backup Confirmation

Before upgrading, confirm a recent backup exists or take one if required.

```bash
# Confirm last backup timestamp (adjust path to your backup location)
ls -lh <backup-directory>
```

> Do not proceed without a verified backup in environments where data loss is unacceptable.

---

## Step 5 — Check Replication Lag (Replica Set Only)

If this node is part of a replica set, verify it is fully synced before proceeding.

```bash
mongosh --eval "rs.status()"
```

Confirm:
- Node state is `SECONDARY` (or `PRIMARY` if upgrading last)
- `optimeDate` lag is within acceptable threshold (typically < 10 seconds)

---

## Step 6 — Graceful Service Shutdown

```bash
sudo systemctl stop $MONGO_SERVICE
```

Confirm the process has fully stopped:

```bash
ps -ef | grep mongod
```

Expected: no `mongod` process remaining.

---

## Step 7 — Check Currently Installed Packages

```bash
sudo yum list installed | grep mongodb
```

Note the currently installed package names and versions for rollback reference.

---

## Step 8 — Upgrade MongoDB Packages

### Option A — Upgrade to Latest Available in Repo

```bash
sudo yum upgrade mongodb-org
```

### Option B — Upgrade to a Specific Version

```bash
sudo yum install -y \
  mongodb-org-$MONGO_VERSION \
  mongodb-org-database-$MONGO_VERSION \
  mongodb-org-server-$MONGO_VERSION \
  mongodb-org-mongos-$MONGO_VERSION \
  mongodb-org-tools-$MONGO_VERSION \
  mongodb-mongosh
```

---

## Step 9 — Prevent Accidental Auto-Upgrade (Recommended)

Pin the installed version to avoid unintended upgrades during routine `yum update` runs.

```bash
# Add to /etc/yum.conf or create a repo exclude
echo "exclude=mongodb-org,mongodb-org-*" | sudo tee -a /etc/yum.conf
```

---

## Step 10 — Verify Installed Version

```bash
mongod --version
```

Confirm the output reflects `$MONGO_VERSION` before starting the service.

---

## Step 11 — Review Config Before Start

```bash
cat $MONGO_CFG
```

Confirm `dbPath`, log path, and `net.port` are unchanged and correct.

---

## Step 12 — Start the Service

```bash
sudo systemctl start $MONGO_SERVICE
```

Enable on boot if not already set:

```bash
sudo systemctl enable $MONGO_SERVICE
```

---

## Step 13 — Post-Start Verification

```bash
# Confirm service is running
sudo systemctl status $MONGO_SERVICE

# Confirm process is running
ps -ef | grep mongod

# Connect via mongosh
mongosh

# Inside mongosh — confirm server version
db.adminCommand({ serverStatus: 1 }).version

# Check for startup errors in the log
sudo tail -50 $MONGO_LOG/mongod.log
```

Look for the following confirmation line in the log:

```
Waiting for connections on port <port>
```

---

## Troubleshooting

| Symptom | Likely Cause | Action |
|---|---|---|
| `yum install` fails | Repo unreachable or GPG key mismatch | Verify `$MONGO_REPO` config and network access |
| Service fails to start | Config or permission issue | Inspect `$MONGO_LOG/mongod.log` for the error |
| `ECONNREFUSED` on `mongosh` | `mongod` still starting up | Wait a few seconds, then check `systemctl status` |
| `mongod --version` shows old version | Old binary still in PATH | Run `which mongod` to confirm the resolved binary |
| Dependency conflict during upgrade | Conflicting existing packages | Run `sudo yum check` and resolve listed conflicts |

---

## Rollback Procedure

If the upgraded version is unstable, roll back to the previous version:

```bash
# Step 1 — Stop the service
sudo systemctl stop $MONGO_SERVICE

# Step 2 — Downgrade to previous version
sudo yum downgrade \
  mongodb-org-<previous-version> \
  mongodb-org-database-<previous-version> \
  mongodb-org-server-<previous-version> \
  mongodb-org-mongos-<previous-version> \
  mongodb-org-tools-<previous-version>

# Step 3 — Verify downgraded version
mongod --version

# Step 4 — Restart the service
sudo systemctl start $MONGO_SERVICE
```

> **Important:** If the data files were opened by the newer version and the WiredTiger compatibility version was advanced, a downgrade may not be possible without restoring from backup. Always verify `featureCompatibilityVersion` before upgrading in production.

---

## Post-Upgrade Checklist

- [ ] `mongod` service running and in `active` state
- [ ] `mongosh` connects successfully
- [ ] Server version confirmed via `serverStatus`
- [ ] No errors in `$MONGO_LOG/mongod.log`
- [ ] Version pinned in `/etc/yum.conf` to prevent unintended auto-upgrade
- [ ] `featureCompatibilityVersion` reviewed and updated if required
- [ ] Replica set health confirmed via `rs.status()` (replica set environments only)
- [ ] Previous package version noted for rollback reference

---

## Key Differences vs. Tarball Installation

| Aspect | Package (YUM/DNF) | Tarball |
|---|---|---|
| Binary location | Standard system path (e.g. `/usr/bin`) | Custom `$MONGO_NEW_BIN/bin` |
| Service management | `systemctl` | Manual (`mongod --config ...`) |
| PATH update | Not required | Required (`~/.bash_profile`) |
| Ownership management | Handled by package manager | Manual `chown` required |
| Rollback mechanism | `yum downgrade` | Revert `PATH`, restart old binary |
| Config location | System config path | Custom `$MONGO_CFG` |

---
