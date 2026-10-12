// =============================================================================
// Script      : check_nesting_depth_collection.js
// Description : Scans a single MongoDB collection for documents whose nesting
//               depth exceeds the configured threshold (default 97 — the AWS
//               DMS hard limit). Recurses into both objects AND arrays, since
//               both count as a nesting level in DMS. Use as a pre-migration /
//               pre-upgrade compatibility check.
// Author      : Madan U
// Email       : madanu135@gmail.com
// Platform    : MongoFleet — MongoDB DBA Platform
// Usage       : mongosh <host>/<db> check_nesting_depth_collection.js
//               mongosh "mongodb://<host>:27017" --file check_nesting_depth_collection.js
// =============================================================================

// ============ CONFIGURATION ============
var config = {
    dbName            : "YOUR_DB_NAME",          // <-- Change this
    collectionName    : "YOUR_COLLECTION_NAME",  // <-- Change this
    nestingThreshold  : 97,                      // DMS hard limit
    stopAtFirst       : false,                   // true = halt after first violation
    batchSize         : 1000,                    // cursor fetch batch size
};
// =======================================


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function timestamp() {
    return new Date().toISOString();
}

function line(char, len) {
    var s = ""; for (var i = 0; i < (len || 72); i++) s += (char || "-"); return s;
}

// Recursively calculates the maximum nesting depth of a value.
// Both objects and arrays count as a nesting level (matches DMS behaviour).
function getNestingLevel(val) {
    if (val === null || typeof val !== "object") return 0;

    var maxChildDepth = 0;

    if (Array.isArray(val)) {
        // Each array element may be a sub-document — recurse into each
        for (var i = 0; i < val.length; i++) {
            var d = getNestingLevel(val[i]);
            if (d > maxChildDepth) maxChildDepth = d;
        }
    } else {
        // Plain object — recurse into each field value
        for (var key in val) {
            if (!val.hasOwnProperty(key)) continue;
            var d = getNestingLevel(val[key]);
            if (d > maxChildDepth) maxChildDepth = d;
        }
    }

    return maxChildDepth + 1;
}


// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

print(line("="));
print("  MongoFleet — Nesting Depth Scanner  [collection-wise]");
print("  Author    : Madan U <madanu135@gmail.com>");
print("  Started   : " + timestamp());
print(line("="));
print("  Database   : " + config.dbName);
print("  Collection : " + config.collectionName);
print("  Threshold  : " + config.nestingThreshold + " levels  (DMS limit)");
print("  Stop-first : " + config.stopAtFirst);
print("  Batch size : " + config.batchSize);
print(line("-"));

var stats = {
    scanned    : 0,
    exceeded   : 0,
    maxSeen    : 0,  // deepest document found across the whole collection
    maxSeenId  : null,
    errors     : 0,
};
var excessiveNestingExists = false;

try {
    var dbt = db.getSiblingDB(config.dbName);

    // 1. Verify collection exists
    var exists = dbt.getCollectionNames().indexOf(config.collectionName) !== -1;
    if (!exists) {
        print('[ERROR] Collection "' + config.collectionName +
              '" does not exist in database "' + config.dbName + '".');
        print('        Check your config and try again.');
        stats.errors++;
    } else {

        // 2. Scan every document
        var cursor = dbt[config.collectionName].find().batchSize(config.batchSize);

        while (cursor.hasNext()) {
            var doc = cursor.next();
            stats.scanned++;

            var depth = getNestingLevel(doc);

            // Track the deepest document seen regardless of threshold
            if (depth > stats.maxSeen) {
                stats.maxSeen   = depth;
                stats.maxSeenId = doc._id;
            }
