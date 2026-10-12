// =============================================================================
// Script      : export_indexes.js
// Description : Exports all non-default indexes across every user database on
//               a MongoDB instance as ready-to-run createIndex() commands.
//               Skips system databases (local, admin, config) and the built-in
//               _id_ index. Preserves unique and TTL (expireAfterSeconds)
//               options. Output can be replayed on a target instance to
//               recreate the index structure — useful for migrations, cluster
//               cloning, or index documentation.
// Author      : Madan U
// Email       : madanu135@gmail.com
// =============================================================================
 
var excludeDatabases = ["local", "admin", "config"];

db.getMongo().getDBNames().forEach(function (dbName) {

    if (!excludeDatabases.includes(dbName)) {

        var currentDB = db.getMongo().getDB(dbName);

        currentDB.getCollectionNames().forEach(function (collection) {

            currentDB[collection].getIndexes().forEach(function (index) {

                if (index.name !== "_id_") {

                    var cmd = "db." + collection + ".createIndex(" + JSON.stringify(index.key);

                    var options = {};

                    if (index.unique) options.unique = true;

                    if (index.expireAfterSeconds) options.expireAfterSeconds = index.expireAfterSeconds;

                    if (Object.keys(options).length > 0) {

                        cmd += ", " + JSON.stringify(options);

                    }

                    cmd += ");";

                    print("-- " + dbName + "." + collection);

                    print(cmd);

                    print("");

                }

            });

        });

    }

});
