// =============================================================================
// Script      : wiredtiger_reusable_space_report.js
// Description : Reports WiredTiger block-level reusable (fragmented) space for
//               every collection across all user databases on a sharded cluster
//               or replica set. "File bytes available for reuse" indicates
//               on-disk space that WiredTiger has freed internally but not yet
//               released back to the OS — a key indicator of fragmentation that
//               can be reclaimed via a compact operation.
//
// Usage       : mongosh --quiet --file wiredtiger_reusable_space_report.js
//
// Output      : Per-collection block showing shard, namespace, and reusable
//               bytes as reported by the WiredTiger storage engine.
//
// Columns     :
//   ns            — Namespace (database.collection)
//   shard         — Shard name the data segment resides on
//   file bytes    — Bytes available for internal reuse (fragmented space)
//
// Author      : Madan U
// Email       : madanu135@gmail.com
//
// Notes       :
//   - Must be run against a mongos (sharded) or primary (replica set) node.
//   - Requires $collStats privilege on all target collections.
//   - Skips system databases: admin, config, local.
//   - Collections that cannot be accessed are skipped with an error message.
//   - High reusable bytes suggest running db.collection.compact() during a
//     maintenance window to reclaim space.
// =============================================================================

db.getMongo().getDBNames().forEach(function (dbName) {

    // Skip internal system databases
    if (["admin", "config", "local"].includes(dbName)) return;

    db.getSiblingDB(dbName).getCollectionNames().forEach(function (collectionName) {
        try {
            print("\n" + "=".repeat(60));
            print("Database   : " + dbName);
            print("Collection : " + collectionName);
            print("=".repeat(60));

            db.getSiblingDB(dbName)
              .getCollection(collectionName)
              .aggregate([
                  { $collStats: { storageStats: {} } },
                  {
                      $project: {
                          _id: 0,
                          ns:    1,
                          shard: 1,
                          "storageStats.wiredTiger.block-manager.file bytes available for reuse": 1
                      }
                  }
              ])
              .forEach(printjson);

        } catch (error) {
            print("  [SKIPPED] " + dbName + "." + collectionName + " — " + error.message);
        }
    });
});
