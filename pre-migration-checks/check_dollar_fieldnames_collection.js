// =============================================================================
// Script      : check_dollar_fieldnames_collection.js
// Description : Scans a single MongoDB collection for "$" (dollar sign)
//               characters in the collection name and in all document field
//               names (recursively, including nested objects and arrays).
//               Use this as a pre-upgrade compatibility check before any
//               MongoDB version bump or data migration.
// Author      : Madan U
// Email       : madanu135@gmail.com
// Platform    : MongoFleet — MongoDB DBA Platform
// Usage       : mongosh <host>/<db> check_dollar_fieldnames_collection.js
//               mongosh "mongodb://<host>:27017" --file check_dollar_fieldnames_collection.js
// =============================================================================

// ============ CONFIGURATION ============
var config = {
    dbName         : "DBNAME",           // <-- Change this
    collectionName : "COLLECTION_NAME",  // <-- Change this
    stopAtFirst    : false,              // true = halt scan after first match (faster for large collections)
    batchSize      : 1000,              // cursor fetch batch size
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

// Recursively walk an object (and arrays within it) looking for any key that
// contains "$". Returns { found: true, path: "field.nested.key" } on first
// hit, or { found: false } if clean. Tracks the full dot-path so you know
// exactly which field to fix.
function hasDollarKey(obj, parentPath) {
    if (!obj || typeof obj !== "object") return { found: false };

    for (var key in obj) {
        if (!obj.hasOwnProperty(key)) continue;
        var fullPath = parentPath ? parentPath + "." + key : key;

        // Dollar found in this key name
        if (key.indexOf("$") !== -1) {
            return { found: true, path: fullPath };
        }

        var val = obj[key];

        // Recurse into nested documents
        if (val !== null && typeof val === "object" && !Array.isArray(val)) {
            var r = hasDollarKey(val, fullPath);
            if (r.found) return r;
        }

        // Recurse into arrays (elements may be sub-documents)
        if (Array.isArray(val)) {
            for (var i = 0; i < val.length; i++) {
                if (val[i] !== null && typeof val[i] === "object") {
                    var ar = hasDollarKey(val[i], fullPath + "[" + i + "]");
                    if (ar.found) return ar;
                }
            }
        }
    }
    return { found: false };
}


// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

print(line("="));
print("  MongoFleet — Dollar Symbol Field Name Scanner  [collection-wise]");
print("  Author  : Madan U <madanu135@gmail.com>");
print("  Started : " + timestamp());
print(line("="));
print("  Database   : " + config.dbName);
print("  Collection : " + config.collectionName);
print("  Stop-first : " + config.stopAtFirst);
print("  Batch size : " + config.batchSize);
print(line("-"));

var stats = {
    scanned : 0,
    matched : 0,
    errors  : 0,
};
var dollarSymbolExists = false;

try {
    var dbt = db.getSiblingDB(config.dbName);

    // 1. Check if the collection name itself contains "$"
    if (config.collectionName.indexOf("$") !== -1) {
        print('[WARN]  "$" found in collection name itself.');
        print('        DB: ' + config.dbName + '  Collection: ' + config.collectionName);
        dollarSymbolExists = true;
        stats.matched++;
    } else {

        // 2. Verify the collection exists before scanning
        var exists = dbt.getCollectionNames().indexOf(config.collectionName) !== -1;
        if (!exists) {
            print('[ERROR] Collection "' + config.collectionName +
                  '" does not exist in database "' + config.dbName + '".');
            print('        Check your config and try again.');
            stats.errors++;
        } else {

            // 3. Scan every document in the collection
            var cursor = dbt[config.collectionName].find().batchSize(config.batchSize);

            while (cursor.hasNext()) {
                var doc = cursor.next();
                stats.scanned++;

                var result = hasDollarKey(doc, "");
                if (result.found) {
                    print('[MATCH] DB: '         + config.dbName         +
                          '  |  Collection: '   + config.collectionName  +
                          '  |  _id: '          + doc._id                +
                          '  |  Field path: "'  + result.path + '"');
                    dollarSymbolExists = true;
                    stats.matched++;

                    if (config.stopAtFirst) {
                        print('[INFO]  stopAtFirst=true — halting after first match.');
                        break;
                    }
                }
            }

            if (stats.matched === 0) {
                print('[OK]    No "$" found in any field name.');
                print('        DB: ' + config.dbName + '  Collection: ' + config.collectionName);
            }
        }
    }

} catch (e) {
    print('[ERROR] Exception during scan: ' + e.message);
    stats.errors++;
}


// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

print(line("-"));
print("  SUMMARY");
print("  Documents scanned : " + stats.scanned);
print("  Matches found     : " + stats.matched);
print("  Errors            : " + stats.errors);
print("  Dollar key exists : " + dollarSymbolExists);
print("  Finished          : " + timestamp());
print(line("="));
