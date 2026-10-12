// =============================================================================
// Script      : check_ttl_indexes_fleet.js
// Description : Scans a our all MongoDB collection for for TTL (Time-To-Live) indexes.
//               pre-migration compatibility check.
// Author      : Madan U
// Email       : madanu135@gmail.com
// =============================================================================

function checkAllTTLIndexes() {
    var ttlIndexExists = false;
    var ignoreDBs = ['admin', 'config', 'local'];
 
    db.getMongo().getDBNames().forEach(function(dbName) {
        if (ignoreDBs.includes(dbName)) {
            print (`Ignoring ${dbName} DB`)
            return;
        }
        var dbt = db.getSiblingDB(dbName);
 
        dbt.getCollectionNames().forEach(function(collectionName) {
            var indexes = dbt[collectionName].getIndexes();
 
            indexes.forEach(function(index) {
                if ('expireAfterSeconds' in index) {
                    ttlIndexExists = true;
                    print(`TTL index found in DB: ${dbName}, Collection: ${collectionName}`);
                }
            });
        });
    });
 
    return ttlIndexExists;
}
