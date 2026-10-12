// =============================================================================
// Script      : collection_size_report.js
// Description : Generates a CSV report of document counts, index counts, and
//               storage metrics for every accessible collection across all
//               user databases on a MongoDB instance. Outputs both logical
//               (uncompressed) and physical (WiredTiger compressed) sizes in
//               megabytes. Useful for capacity planning, storage audits, and
//               pre-migration assessments.
//
// Author      : Madan U
// Email       : madanu135@gmail.com
//
// Output      : CSV to stdout — redirect to a file as shown above.
//
// Columns     :
//   DBName          — Database name
//   CollectionName  — Collection name
//   DocumentCount   — Number of documents
//   IndexCount      — Number of indexes (including _id)
//   DataSizeMB      — Logical (uncompressed) document data size
//   IndexSizeMB     — Logical (uncompressed) index size
//   LogicalTotalMB  — DataSizeMB + IndexSizeMB
//   StorageSizeMB   — Physical on-disk size (WiredTiger compressed + allocated)
//
// Notes       :
//   - Requires listDatabases + collStats privileges on all target databases.
//   - Skips databases or collections that cannot be accessed (silent skip).
//   - Results are sorted alphabetically by database, then collection name.
// =============================================================================

(function () {

    // -------------------------------------------------------------------------
    // CSV Header
    // -------------------------------------------------------------------------
    print("DBName,CollectionName,DocumentCount,IndexCount,DataSizeMB,IndexSizeMB,LogicalTotalMB,StorageSizeMB");

    // -------------------------------------------------------------------------
    // Retrieve all accessible databases
    // -------------------------------------------------------------------------
    var dbListCmd = db.getSiblingDB("admin").runCommand({
        listDatabases: 1,
        authorizedDatabases: true
    });

    if (!dbListCmd || dbListCmd.ok !== 1) {
        throw new Error("Failed to list databases. Ensure the connected user has listDatabases privilege.");
    }

    var databases = (dbListCmd.databases || []).sort(function (a, b) {
        return a.name.localeCompare(b.name);
    });

    // -------------------------------------------------------------------------
    // Iterate databases and collections
    // -------------------------------------------------------------------------
    databases.forEach(function (dbInfo) {

        var dbName = dbInfo.name;
        var dbObj  = db.getSiblingDB(dbName);
        var collNames = [];

        try {
            collNames = dbObj.getCollectionNames();
        } catch (e) {
            return; // Skip inaccessible databases silently
        }

        collNames.sort(function (a, b) {
            return a.localeCompare(b);
        });

        collNames.forEach(function (collName) {
            try {
                var stats = dbObj.runCommand({ collStats: collName });

                if (!stats || stats.ok !== 1) return;

                var docCount = stats.count        || 0;
                var idxCount = stats.nindexes     || 0;

                // Logical sizes (uncompressed, in-memory representation)
                var dataSizeMB     = (stats.size           || 0) / (1024 * 1024);
                var indexSizeMB    = (stats.totalIndexSize || 0) / (1024 * 1024);
                var logicalTotalMB = dataSizeMB + indexSizeMB;

                // Physical size (WiredTiger compressed + allocation padding)
                var storageSizeMB  = (stats.storageSize    || 0) / (1024 * 1024);

                // Escape double quotes in names for RFC 4180 CSV compliance
                var dbCSV   = '"' + dbName.replace(/"/g, '""')   + '"';
                var collCSV = '"' + collName.replace(/"/g, '""') + '"';

                print(
                    dbCSV          + "," +
                    collCSV        + "," +
                    docCount       + "," +
                    idxCount       + "," +
                    dataSizeMB.toFixed(3)     + "," +
                    indexSizeMB.toFixed(3)    + "," +
                    logicalTotalMB.toFixed(3) + "," +
                    storageSizeMB.toFixed(3)
                );

            } catch (e) {
                // Skip inaccessible collections silently
            }
        });
    });

})();
